-- Sincroniza el catalogo operativo de Perez's Burger sin tocar pedidos ni
-- snapshots historicos. Listo para pegar en SQL Editor.
--
-- Esquema real inspeccionado:
-- products base: id, category_id, name, price, active, sort_order, image_url.
-- Nueva Comanda usa products.variant_prices para Simple/Doble/Triple, por eso
-- esta columna si se agrega de forma explicita y segura cuando falta.
-- No se usa description para que el script funcione aunque esa columna no exista.

alter table products
  add column if not exists variant_prices jsonb not null default '{}'::jsonb;

do $$
declare
  v_hamburguesas uuid;
  v_extras uuid;
  v_dips uuid;
  v_bebidas uuid;
begin
  update categories set name = 'Hamburguesas', active = true, sort_order = 10 where lower(name) = 'hamburguesas';
  update categories set name = 'Extras', active = true, sort_order = 20 where lower(name) = 'extras';
  update categories set name = 'Dips', active = true, sort_order = 30 where lower(name) = 'dips';
  update categories set name = 'Bebidas', active = true, sort_order = 40 where lower(name) = 'bebidas';

  insert into categories (name, sort_order, active)
  select 'Hamburguesas', 10, true
  where not exists (select 1 from categories where lower(name) = 'hamburguesas');

  insert into categories (name, sort_order, active)
  select 'Extras', 20, true
  where not exists (select 1 from categories where lower(name) = 'extras');

  insert into categories (name, sort_order, active)
  select 'Dips', 30, true
  where not exists (select 1 from categories where lower(name) = 'dips');

  insert into categories (name, sort_order, active)
  select 'Bebidas', 40, true
  where not exists (select 1 from categories where lower(name) = 'bebidas');

  select id into v_hamburguesas from categories where lower(name) = 'hamburguesas' order by sort_order limit 1;
  select id into v_extras from categories where lower(name) = 'extras' order by sort_order limit 1;
  select id into v_dips from categories where lower(name) = 'dips' order by sort_order limit 1;
  select id into v_bebidas from categories where lower(name) = 'bebidas' order by sort_order limit 1;

  if v_hamburguesas is null or v_extras is null or v_dips is null or v_bebidas is null then
    raise exception 'Faltan categorias base del catalogo de Perez''s Burger';
  end if;

  -- Solo se desactiva el catalogo anterior. Los pedidos historicos conservan
  -- product_name_snapshot y unit_price_snapshot.
  update products
  set active = false
  where name in (
    'Clasica', 'Cheddar', 'Doble', 'Bacon', 'Especial',
    'Papas chicas', 'Papas grandes', 'Gaseosa', 'Agua',
    'De la semana', 'Papas', 'Boniatos', 'Nuggets',
    'Dip de cheddar', 'Dip cheddar', 'Dip alioli', 'Dip barbacoa',
    'Gaseosa lata', 'Agua mineral 1.5L', 'Miller', 'Heineken', 'Budweiser'
  )
  or name = 'Cl' || chr(225) || 'sica';

  update products p set
    category_id = v_hamburguesas,
    price = item.simple,
    variant_prices = jsonb_build_object('Simple', item.simple, 'Doble', item.doble, 'Triple', item.triple),
    image_url = '/menu/burger.svg',
    active = true,
    sort_order = item.sort_order
  from (values
    ('Cheeseburger', 11300::numeric, 12600::numeric, 14100::numeric, 10),
    ('Cheesebacon', 12300::numeric, 13800::numeric, 15300::numeric, 20),
    ('Criolla', 12300::numeric, 13800::numeric, 15300::numeric, 30),
    ('BBQ Bacon', 12800::numeric, 14200::numeric, 15600::numeric, 40)
  ) as item(name, simple, doble, triple, sort_order)
  where p.name = item.name;

  insert into products (category_id, name, price, variant_prices, image_url, active, sort_order)
  select v_hamburguesas, item.name, item.simple,
    jsonb_build_object('Simple', item.simple, 'Doble', item.doble, 'Triple', item.triple),
    '/menu/burger.svg', true, item.sort_order
  from (values
    ('Cheeseburger', 11300::numeric, 12600::numeric, 14100::numeric, 10),
    ('Cheesebacon', 12300::numeric, 13800::numeric, 15300::numeric, 20),
    ('Criolla', 12300::numeric, 13800::numeric, 15300::numeric, 30),
    ('BBQ Bacon', 12800::numeric, 14200::numeric, 15600::numeric, 40)
  ) as item(name, simple, doble, triple, sort_order)
  where not exists (select 1 from products p where p.name = item.name);

  update products p set
    category_id = v_extras,
    price = item.price,
    variant_prices = '{}'::jsonb,
    image_url = item.image_url,
    active = true,
    sort_order = item.sort_order
  from (values
    ('Papas Sazonadas', 3500::numeric, '/menu/fries.svg', 10),
    ('Boniatos Sazonados', 5000::numeric, '/menu/fries.svg', 20),
    ('Nuggets x8', 5000::numeric, '/menu/nuggets.svg', 30),
    ('Aros de Cebolla x8', 5500::numeric, '/menu/onion-rings.svg', 40),
    ('Extra Carne', 1800::numeric, '/menu/extra-meat.svg', 50)
  ) as item(name, price, image_url, sort_order)
  where p.name = item.name;

  insert into products (category_id, name, price, variant_prices, image_url, active, sort_order)
  select v_extras, item.name, item.price, '{}'::jsonb, item.image_url, true, item.sort_order
  from (values
    ('Papas Sazonadas', 3500::numeric, '/menu/fries.svg', 10),
    ('Boniatos Sazonados', 5000::numeric, '/menu/fries.svg', 20),
    ('Nuggets x8', 5000::numeric, '/menu/nuggets.svg', 30),
    ('Aros de Cebolla x8', 5500::numeric, '/menu/onion-rings.svg', 40),
    ('Extra Carne', 1800::numeric, '/menu/extra-meat.svg', 50)
  ) as item(name, price, image_url, sort_order)
  where not exists (select 1 from products p where p.name = item.name);

  update products p set
    category_id = v_dips,
    price = 1500,
    variant_prices = '{}'::jsonb,
    image_url = '/menu/dip.svg',
    active = true,
    sort_order = item.sort_order
  from (values
    ('Dip Cheddar', 10),
    ('Dip Alioli', 20),
    ('Dip Barbacoa', 30)
  ) as item(name, sort_order)
  where p.name = item.name;

  insert into products (category_id, name, price, variant_prices, image_url, active, sort_order)
  select v_dips, item.name, 1500, '{}'::jsonb, '/menu/dip.svg', true, item.sort_order
  from (values
    ('Dip Cheddar', 10),
    ('Dip Alioli', 20),
    ('Dip Barbacoa', 30)
  ) as item(name, sort_order)
  where not exists (select 1 from products p where p.name = item.name);

  update products p set
    category_id = v_bebidas,
    price = item.price,
    variant_prices = '{}'::jsonb,
    image_url = '/menu/drink.svg',
    active = true,
    sort_order = item.sort_order
  from (values
    ('Gaseosa lata 354ml', 1700::numeric, 10),
    ('Gaseosa 1.5L', 4600::numeric, 20),
    ('Agua Mineral 1.5L', 3500::numeric, 30),
    ('Miller 330ml', 3300::numeric, 40),
    ('Heineken 330ml', 3300::numeric, 50),
    ('Budweiser 330ml', 3300::numeric, 60)
  ) as item(name, price, sort_order)
  where p.name = item.name;

  insert into products (category_id, name, price, variant_prices, image_url, active, sort_order)
  select v_bebidas, item.name, item.price, '{}'::jsonb, '/menu/drink.svg', true, item.sort_order
  from (values
    ('Gaseosa lata 354ml', 1700::numeric, 10),
    ('Gaseosa 1.5L', 4600::numeric, 20),
    ('Agua Mineral 1.5L', 3500::numeric, 30),
    ('Miller 330ml', 3300::numeric, 40),
    ('Heineken 330ml', 3300::numeric, 50),
    ('Budweiser 330ml', 3300::numeric, 60)
  ) as item(name, price, sort_order)
  where not exists (select 1 from products p where p.name = item.name);
end;
$$;
