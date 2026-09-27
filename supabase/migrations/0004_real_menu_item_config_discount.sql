-- Etapa: menu real, configuracion por item y descuento efectivo miercoles/jueves

alter table order_items
  add column if not exists item_comment text,
  add column if not exists item_config jsonb not null default '{}'::jsonb,
  add column if not exists capacity_units integer not null default 0;

alter table order_items
  add constraint order_items_capacity_units_non_negative check (capacity_units >= 0);

alter table payments
  add column if not exists subtotal_amount numeric(10,2),
  add column if not exists discount_amount numeric(10,2) not null default 0,
  add column if not exists discount_percent numeric(5,2) not null default 0;

update payments
  set subtotal_amount = amount
  where subtotal_amount is null;

do $$
declare
  v_hamburguesas uuid;
  v_extras uuid;
  v_dips uuid;
  v_bebidas uuid;
begin
  update products
    set active = false
    where name in (
      'Clasica',
      'Clásica',
      'Cheddar',
      'Doble',
      'Bacon',
      'Especial',
      'Papas chicas',
      'Papas grandes',
      'Gaseosa',
      'Agua'
    );

  update categories
    set active = false
    where name in ('Hamburguesas', 'Papas', 'Bebidas');

  insert into categories (name, sort_order, active)
  select 'HAMBURGUESAS', 10, true
  where not exists (select 1 from categories where name = 'HAMBURGUESAS')
  returning id into v_hamburguesas;
  select id into v_hamburguesas from categories where name = 'HAMBURGUESAS' limit 1;

  insert into categories (name, sort_order, active)
  select 'EXTRAS', 20, true
  where not exists (select 1 from categories where name = 'EXTRAS')
  returning id into v_extras;
  select id into v_extras from categories where name = 'EXTRAS' limit 1;

  insert into categories (name, sort_order, active)
  select 'DIPS', 30, true
  where not exists (select 1 from categories where name = 'DIPS')
  returning id into v_dips;
  select id into v_dips from categories where name = 'DIPS' limit 1;

  insert into categories (name, sort_order, active)
  select 'BEBIDAS', 40, true
  where not exists (select 1 from categories where name = 'BEBIDAS')
  returning id into v_bebidas;
  select id into v_bebidas from categories where name = 'BEBIDAS' limit 1;

  insert into products (category_id, name, description, price, active, sort_order)
  select v_hamburguesas, product_name, 'Precio pendiente de carga', 0, true, product_sort
  from (values
    ('Cheeseburger', 10),
    ('Cheesebacon', 20),
    ('Criolla', 30),
    ('De la semana', 40)
  ) as seed(product_name, product_sort)
  where not exists (
    select 1 from products p where p.category_id = v_hamburguesas and p.name = seed.product_name
  );

  insert into products (category_id, name, description, price, active, sort_order)
  select v_extras, product_name, 'Precio pendiente de carga', 0, true, product_sort
  from (values
    ('Papas', 10),
    ('Boniatos', 20),
    ('Nuggets', 30)
  ) as seed(product_name, product_sort)
  where not exists (
    select 1 from products p where p.category_id = v_extras and p.name = seed.product_name
  );

  insert into products (category_id, name, description, price, active, sort_order)
  select v_dips, product_name, 'Precio pendiente de carga', 0, true, product_sort
  from (values
    ('Dip de cheddar', 10),
    ('Dip alioli', 20),
    ('Dip barbacoa', 30)
  ) as seed(product_name, product_sort)
  where not exists (
    select 1 from products p where p.category_id = v_dips and p.name = seed.product_name
  );

  insert into products (category_id, name, description, price, active, sort_order)
  select v_bebidas, product_name, 'Precio pendiente de carga', 0, true, product_sort
  from (values
    ('Gaseosa lata', 10),
    ('Gaseosa 1.5L', 20),
    ('Agua mineral 1.5L', 30),
    ('Miller', 40),
    ('Heineken', 50),
    ('Budweiser', 60)
  ) as seed(product_name, product_sort)
  where not exists (
    select 1 from products p where p.category_id = v_bebidas and p.name = seed.product_name
  );
end;
$$;

create or replace function create_order(
  p_customer_name text,
  p_pickup_time timestamptz,
  p_notes text,
  p_items jsonb
) returns orders as $$
declare
  v_order orders;
  v_item jsonb;
  v_order_item order_items;
  v_modifier jsonb;
  v_unit_price numeric(10,2);
  v_quantity int;
  v_item_subtotal numeric(10,2);
  v_modifiers_total numeric(10,2);
  v_total numeric(10,2) := 0;
begin
  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido debe tener items';
  end if;

  insert into orders (customer_name, pickup_time, notes, created_by)
  values (p_customer_name, p_pickup_time, p_notes, auth.uid())
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_unit_price := coalesce((v_item->>'unit_price')::numeric, 0);
    v_quantity := coalesce((v_item->>'quantity')::int, 1);
    v_modifiers_total := 0;

    for v_modifier in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb))
    loop
      v_modifiers_total := v_modifiers_total + coalesce((v_modifier->>'price')::numeric, 0);
    end loop;

    v_item_subtotal := (v_unit_price + v_modifiers_total) * v_quantity;
    v_total := v_total + v_item_subtotal;

    insert into order_items (
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
    values (
      v_order.id,
      nullif(v_item->>'product_id', '')::uuid,
      v_item->>'product_name',
      v_unit_price,
      v_quantity,
      v_item_subtotal,
      nullif(v_item->>'item_comment', ''),
      coalesce(v_item->'item_config', '{}'::jsonb),
      coalesce((v_item->>'capacity_units')::int, 0)
    )
    returning * into v_order_item;

    for v_modifier in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb))
    loop
      insert into order_item_modifiers (
        order_item_id,
        modifier_id,
        name_snapshot,
        price_snapshot,
        type_snapshot
      )
      values (
        v_order_item.id,
        nullif(v_modifier->>'modifier_id', '')::uuid,
        v_modifier->>'name',
        coalesce((v_modifier->>'price')::numeric, 0),
        coalesce(v_modifier->>'type', 'addon')
      );
    end loop;
  end loop;

  update orders set total = v_total where id = v_order.id returning * into v_order;
  return v_order;
end;
$$ language plpgsql security definer;

create or replace function close_order_with_payment(
  p_order_id uuid,
  p_method text,
  p_amount numeric,
  p_received_amount numeric default null
) returns orders as $$
declare
  v_order orders;
  v_received numeric(10,2);
  v_subtotal numeric(10,2);
  v_discount_percent numeric(5,2) := 0;
  v_discount_amount numeric(10,2) := 0;
  v_final_total numeric(10,2);
  v_business_day int;
begin
  if p_method not in ('cash', 'transfer') then
    raise exception 'Metodo de pago invalido';
  end if;

  select * into v_order from orders where id = p_order_id for update;

  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  if v_order.payment_status = 'paid' then
    raise exception 'El pedido ya fue pagado';
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'No se puede cobrar un pedido cancelado';
  end if;

  v_subtotal := coalesce(v_order.total, 0);
  v_business_day := extract(isodow from (coalesce(v_order.pickup_time, v_order.created_at) at time zone 'America/Argentina/Buenos_Aires'));

  if p_method = 'cash' and v_business_day in (3, 4) then
    v_discount_percent := 10;
    v_discount_amount := round(v_subtotal * 0.10, 2);
  end if;

  v_final_total := v_subtotal - v_discount_amount;

  if p_amount <> v_final_total then
    raise exception 'El monto no coincide con el total final del pedido';
  end if;

  if p_method = 'cash' then
    v_received := coalesce(p_received_amount, 0);
    if v_received < v_final_total then
      raise exception 'El monto recibido es insuficiente';
    end if;
  else
    v_received := null;
  end if;

  insert into payments (
    order_id,
    method,
    amount,
    received_amount,
    change_amount,
    subtotal_amount,
    discount_amount,
    discount_percent,
    received_by
  )
  values (
    p_order_id,
    p_method,
    v_final_total,
    v_received,
    case when p_method = 'cash' then v_received - v_final_total else null end,
    v_subtotal,
    v_discount_amount,
    v_discount_percent,
    auth.uid()
  );

  update orders
    set payment_status = 'paid',
        closed_by = auth.uid(),
        closed_at = now()
    where id = p_order_id
    returning * into v_order;

  return v_order;
end;
$$ language plpgsql security definer;
