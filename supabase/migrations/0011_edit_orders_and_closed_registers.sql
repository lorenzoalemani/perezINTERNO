-- ==============================================================================
-- Migración 0011: Edición de pedidos y edición de cajas cerradas
-- Pegá TODO este SQL en Supabase → SQL Editor → Run
-- ==============================================================================

-- 1. Políticas RLS para cash_registers
DROP POLICY IF EXISTS "cash_registers_update_staff" ON cash_registers;
CREATE POLICY "cash_registers_update_staff" ON cash_registers FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 2. Función SECURITY DEFINER para actualizar caja cerrada
CREATE OR REPLACE FUNCTION update_closed_cash_register(
  p_register_id uuid,
  p_closing_amount numeric,
  p_difference numeric DEFAULT NULL
) RETURNS cash_registers AS $$
DECLARE
  v_register cash_registers;
BEGIN
  UPDATE cash_registers
  SET closing_amount = p_closing_amount,
      closing_difference_amount = p_difference
  WHERE id = p_register_id
  RETURNING * INTO v_register;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caja no encontrada';
  END IF;

  RETURN v_register;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Políticas RLS para order_items
DROP POLICY IF EXISTS "order_items_update_authenticated" ON order_items;
CREATE POLICY "order_items_update_authenticated" ON order_items FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "order_items_delete_authenticated" ON order_items;
CREATE POLICY "order_items_delete_authenticated" ON order_items FOR DELETE
  USING (auth.role() = 'authenticated');

-- 4. Políticas RLS para order_item_modifiers
DROP POLICY IF EXISTS "oim_update_authenticated" ON order_item_modifiers;
CREATE POLICY "oim_update_authenticated" ON order_item_modifiers FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "oim_delete_authenticated" ON order_item_modifiers;
CREATE POLICY "oim_delete_authenticated" ON order_item_modifiers FOR DELETE
  USING (auth.role() = 'authenticated');

-- 5. Políticas RLS para payments
DROP POLICY IF EXISTS "payments_update_authenticated" ON payments;
CREATE POLICY "payments_update_authenticated" ON payments FOR UPDATE
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');

-- 6. Función SECURITY DEFINER para actualizar un pedido completo
CREATE OR REPLACE FUNCTION update_order(
  p_order_id uuid,
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
  v_prod_id uuid;
  v_mod_id uuid;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido no encontrado';
  END IF;

  -- Eliminar items anteriores
  DELETE FROM order_item_modifiers WHERE order_item_id IN (SELECT id FROM order_items WHERE order_id = p_order_id);
  DELETE FROM order_items WHERE order_id = p_order_id;

  -- Insertar nuevos items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_item_subtotal := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;

    IF v_item ? 'modifiers' THEN
      SELECT coalesce(sum((m->>'price')::numeric), 0) * (v_item->>'quantity')::int
        INTO v_item_subtotal
      FROM jsonb_array_elements(v_item->'modifiers') m;
      v_item_subtotal := v_item_subtotal + (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;
    END IF;

    v_prod_id := NULL;
    IF (v_item->>'product_id') IS NOT NULL AND (v_item->>'product_id') <> '' THEN
      v_prod_id := (v_item->>'product_id')::uuid;
    END IF;

    INSERT INTO order_items (
      order_id,
      product_id,
      product_name_snapshot,
      unit_price_snapshot,
      quantity,
      subtotal,
      item_comment,
      item_config,
      capacity_units
    )
    VALUES (
      v_order.id,
      v_prod_id,
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
        v_mod_id := NULL;
        IF (v_mod->>'modifier_id') IS NOT NULL AND (v_mod->>'modifier_id') <> '' THEN
          v_mod_id := (v_mod->>'modifier_id')::uuid;
        END IF;

        INSERT INTO order_item_modifiers (
          order_item_id,
          modifier_id,
          name_snapshot,
          price_snapshot,
          type_snapshot
        )
        VALUES (
          v_order_item_id,
          v_mod_id,
          v_mod->>'name',
          COALESCE((v_mod->>'price')::numeric, 0),
          v_mod->>'type'
        );
      END LOOP;
    END IF;

    v_total := v_total + v_item_subtotal;
  END LOOP;

  -- Actualizar orden
  UPDATE orders
  SET customer_name = p_customer_name,
      pickup_time = p_pickup_time,
      notes = p_notes,
      total = v_total
  WHERE id = p_order_id
  RETURNING * INTO v_order;

  -- Sincronizar pago si ya estaba pagado
  IF v_order.payment_status = 'paid' THEN
    UPDATE payments
    SET amount = v_total
    WHERE order_id = p_order_id;
  END IF;

  RETURN v_order;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
