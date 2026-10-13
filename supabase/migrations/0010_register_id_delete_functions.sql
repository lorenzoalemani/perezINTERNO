-- ==============================================================================
-- Migración 0010: Vincular pedidos a cajas, funciones de borrado real,
-- restricción de una sola caja abierta, y chequeo de pendientes al cerrar
-- ==============================================================================

-- 1. Agregar register_id a orders (vincula cada pedido a su caja)
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS register_id uuid REFERENCES cash_registers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_orders_register_id ON orders(register_id);

-- 2. Backfill: asignar caja a pedidos existentes según su fecha de creación
UPDATE orders o
SET register_id = (
  SELECT cr.id FROM cash_registers cr
  WHERE o.created_at >= cr.opened_at
    AND (cr.closed_at IS NULL OR o.created_at <= cr.closed_at)
  ORDER BY cr.opened_at DESC
  LIMIT 1
)
WHERE o.register_id IS NULL;

-- 3. Cerrar cajas duplicadas abiertas (quedarse solo con la más reciente)
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY opened_at DESC) as rn
  FROM cash_registers
  WHERE closed_at IS NULL
)
UPDATE cash_registers
SET closed_at = now(), closed_by = opened_by
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 4. Restricción: solo una caja abierta a la vez
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_open_register
  ON cash_registers ((true))
  WHERE closed_at IS NULL;

-- 5. Actualizar create_order para asignar register_id automáticamente
CREATE OR REPLACE FUNCTION create_order(
  p_customer_name text,
  p_pickup_time timestamptz,
  p_notes text,
  p_items jsonb
) RETURNS orders AS $$
DECLARE
  v_order orders;
  v_item jsonb;
  v_mod jsonb;
  v_order_item_id uuid;
  v_total numeric(10,2) := 0;
  v_item_subtotal numeric(10,2);
  v_register_id uuid;
BEGIN
  -- Buscar la caja abierta
  SELECT id INTO v_register_id
  FROM cash_registers
  WHERE closed_at IS NULL
  LIMIT 1;

  IF v_register_id IS NULL THEN
    RAISE EXCEPTION 'No hay una caja abierta. Abrí una caja antes de cargar pedidos.';
  END IF;

  INSERT INTO orders (customer_name, pickup_time, notes, created_by, status, payment_status, total, register_id)
  VALUES (p_customer_name, p_pickup_time, p_notes, auth.uid(), 'pending', 'pending', 0, v_register_id)
  RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_subtotal := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;

    IF v_item ? 'modifiers' THEN
      SELECT coalesce(sum((m->>'price')::numeric), 0) * (v_item->>'quantity')::int
        INTO v_item_subtotal
      FROM jsonb_array_elements(v_item->'modifiers') m;
      v_item_subtotal := v_item_subtotal + (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;
    END IF;

    INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal, item_comment, item_config, capacity_units)
    VALUES (
      v_order.id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::int,
      v_item_subtotal,
      v_item->>'item_comment',
      CASE WHEN v_item ? 'item_config' THEN v_item->'item_config' ELSE NULL END,
      COALESCE((v_item->>'capacity_units')::int, 0)
    )
    RETURNING id INTO v_order_item_id;

    IF v_item ? 'modifiers' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_item->'modifiers')
      LOOP
        INSERT INTO order_item_modifiers (order_item_id, modifier_id, name_snapshot, price_snapshot, type_snapshot)
        VALUES (
          v_order_item_id,
          (v_mod->>'modifier_id')::uuid,
          v_mod->>'name',
          COALESCE((v_mod->>'price')::numeric, 0),
          v_mod->>'type'
        );
      END LOOP;
    END IF;

    v_total := v_total + v_item_subtotal;
  END LOOP;

  UPDATE orders SET total = v_total WHERE id = v_order.id RETURNING * INTO v_order;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Función para eliminar permanentemente un pedido individual
CREATE OR REPLACE FUNCTION delete_order_permanently(p_order_id uuid)
RETURNS void AS $$
BEGIN
  -- El CASCADE en las FK de order_items y payments se encarga de limpiar todo
  DELETE FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Función para limpiar todos los pedidos de una caja (Limpiar pedidos)
CREATE OR REPLACE FUNCTION clear_register_orders(p_register_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_count int;
  v_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(total), 0)
  INTO v_count, v_total
  FROM orders
  WHERE register_id = p_register_id;

  -- Borrar todos los pedidos de esta caja (cascade borra items y pagos)
  DELETE FROM orders WHERE register_id = p_register_id;

  RETURN jsonb_build_object('deleted_count', v_count, 'deleted_total', v_total);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Función para consultar si hay caja abierta (accesible por cajera)
CREATE OR REPLACE FUNCTION has_open_register()
RETURNS jsonb AS $$
DECLARE
  v_register cash_registers;
BEGIN
  SELECT * INTO v_register
  FROM cash_registers
  WHERE closed_at IS NULL
  LIMIT 1;

  IF v_register.id IS NULL THEN
    RETURN jsonb_build_object('open', false);
  END IF;

  RETURN jsonb_build_object(
    'open', true,
    'register_id', v_register.id,
    'opened_at', v_register.opened_at,
    'business_date', v_register.business_date
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 9. Función para obtener resumen de pedidos pendientes (para aviso al cerrar caja)
CREATE OR REPLACE FUNCTION get_register_pending_summary(p_register_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_unpaid_count int;
  v_unpaid_total numeric;
BEGIN
  SELECT count(*), coalesce(sum(total), 0)
  INTO v_unpaid_count, v_unpaid_total
  FROM orders
  WHERE register_id = p_register_id
    AND payment_status = 'pending'
    AND status != 'cancelled';

  RETURN jsonb_build_object(
    'unpaid_count', v_unpaid_count,
    'unpaid_total', v_unpaid_total
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
