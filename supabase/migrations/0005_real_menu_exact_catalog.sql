-- Catalogo real definitivo de Perez's Burger.
-- No borra pedidos ni snapshots historicos: desactiva productos demo y asegura el menu real activo.

alter table order_items
  add column if not exists item_comment text,
  add column if not exists item_config jsonb not null default '{}'::jsonb,
  add column if not exists capacity_units integer not null default 0;

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
      'Agua',
      'Dip de cheddar'
    );

  update categories
    set active = false
    where name in ('Papas');

  update categories set name = 'Hamburguesas', active = true where name = 'HAMBURGUESAS';
  update categories set name = 'Extras', active = true where name = 'EXTRAS';
  update categories set name = 'Dips', active = true where name = 'DIPS';
  update categories set name = 'Bebidas', active = true where name = 'BEBIDAS';

  insert into categories (name, sort_order, active)
  select 'Hamburguesas', 10, true
  where not exists (select 1 from categories where name = 'Hamburguesas');
  select id into v_hamburguesas from categories where name = 'Hamburguesas' limit 1;

  insert into categories (name, sort_order, active)
  select 'Extras', 20, true
  where not exists (select 1 from categories where name = 'Extras');
  select id into v_extras from categories where name = 'Extras' limit 1;

  insert into categories (name, sort_order, active)
  select 'Dips', 30, true
  where not exists (select 1 from categories where name = 'Dips');
  select id into v_dips from categories where name = 'Dips' limit 1;

  insert into categories (name, sort_order, active)
  select 'Bebidas', 40, true
  where not exists (select 1 from categories where name = 'Bebidas');
  select id into v_bebidas from categories where name = 'Bebidas' limit 1;

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
    ('Dip cheddar', 10),
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

  update products
    set category_id = v_dips,
        name = 'Dip cheddar',
        description = coalesce(description, 'Precio pendiente de carga'),
        price = 0,
        active = true,
        sort_order = 10
    where name = 'Dip de cheddar';

  update products
    set active = true,
        description = coalesce(description, 'Precio pendiente de carga')
    where name in (
      'Cheeseburger',
      'Cheesebacon',
      'Criolla',
      'De la semana',
      'Papas',
      'Boniatos',
      'Nuggets',
      'Dip cheddar',
      'Dip alioli',
      'Dip barbacoa',
      'Gaseosa lata',
      'Gaseosa 1.5L',
      'Agua mineral 1.5L',
      'Miller',
      'Heineken',
      'Budweiser'
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
