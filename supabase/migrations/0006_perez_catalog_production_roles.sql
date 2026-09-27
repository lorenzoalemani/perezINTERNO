-- Catálogo vigente de Pérez's Burger. Los pedidos ya creados conservan sus
-- snapshots de nombre y precio; solamente se actualiza el menú disponible.

alter table products
  add column if not exists variant_prices jsonb not null default '{}'::jsonb;

-- La cajera se guarda como "counter" para mantener compatibilidad con los
-- perfiles existentes. La aplicación la presenta como "Cajera".

do $$
declare
  v_hamburguesas uuid;
  v_extras uuid;
  v_dips uuid;
  v_bebidas uuid;
begin
  select id into v_hamburguesas from categories where lower(name) = 'hamburguesas' order by sort_order limit 1;
  select id into v_extras from categories where lower(name) = 'extras' order by sort_order limit 1;
  select id into v_dips from categories where lower(name) = 'dips' order by sort_order limit 1;
  select id into v_bebidas from categories where lower(name) = 'bebidas' order by sort_order limit 1;

  update products set active = false
  where name in ('De la semana', 'Papas', 'Boniatos', 'Nuggets', 'Dip cheddar', 'Dip alioli', 'Dip barbacoa', 'Gaseosa lata', 'Gaseosa 1.5L', 'Agua mineral 1.5L', 'Miller', 'Heineken', 'Budweiser');

  -- Burgers: price keeps the simple amount for admin listings, while
  -- variant_prices is used when the operator chooses the meat size.
  update products p set
    price = item.simple,
    variant_prices = jsonb_build_object('Simple', item.simple, 'Doble', item.doble, 'Triple', item.triple),
    description = 'Elegí simple, doble o triple',
    active = true
  from (values
    ('Cheeseburger', 11300, 12600, 14100),
    ('Cheesebacon', 12300, 13800, 15300),
    ('Criolla', 12300, 13800, 15300),
    ('BBQ Bacon', 12800, 14200, 15600)
  ) as item(name, simple, doble, triple)
  where p.name = item.name;

  insert into products (category_id, name, description, price, variant_prices, active, sort_order)
  select v_hamburguesas, item.name, 'Elegí simple, doble o triple', item.simple,
    jsonb_build_object('Simple', item.simple, 'Doble', item.doble, 'Triple', item.triple), true, item.sort_order
  from (values ('Cheeseburger', 11300, 12600, 14100, 10), ('Cheesebacon', 12300, 13800, 15300, 20), ('Criolla', 12300, 13800, 15300, 30), ('BBQ Bacon', 12800, 14200, 15600, 40)) as item(name, simple, doble, triple, sort_order)
  where not exists (select 1 from products p where p.category_id = v_hamburguesas and p.name = item.name);

  insert into products (category_id, name, description, price, active, sort_order)
  select v_extras, item.name, item.description, item.price, true, item.sort_order
  from (values
    ('Papas Sazonadas', 'Papas con sazonado', 3500, 10),
    ('Boniatos Sazonados', 'Boniatos con sazonado', 5000, 20),
    ('Nuggets x8', 'Porción de 8 unidades', 5000, 30),
    ('Aros de Cebolla x8', 'Porción de 8 unidades', 5500, 40),
    ('Extra Carne', 'Medallón adicional', 1800, 50)
  ) as item(name, description, price, sort_order)
  where not exists (select 1 from products p where p.category_id = v_extras and p.name = item.name);

  insert into products (category_id, name, description, price, active, sort_order)
  select v_dips, item.name, 'Dip individual', 1500, true, item.sort_order
  from (values ('Dip Cheddar', 10), ('Dip Alioli', 20), ('Dip Barbacoa', 30)) as item(name, sort_order)
  where not exists (select 1 from products p where p.category_id = v_dips and p.name = item.name);

  insert into products (category_id, name, description, price, active, sort_order)
  select v_bebidas, item.name, item.description, item.price, true, item.sort_order
  from (values
    ('Gaseosa lata 354ml', 'Lata 354 ml', 1700, 10),
    ('Gaseosa 1.5L', 'Botella 1,5 litros', 4600, 20),
    ('Agua Mineral 1.5L', 'Botella 1,5 litros', 3500, 30),
    ('Miller 330ml', 'Lata 330 ml', 3300, 40),
    ('Heineken 330ml', 'Lata 330 ml', 3300, 50),
    ('Budweiser 330ml', 'Lata 330 ml', 3300, 60)
  ) as item(name, description, price, sort_order)
  where not exists (select 1 from products p where p.category_id = v_bebidas and p.name = item.name);
end;
$$;

-- Caja queda protegida también en la base: el rol counter/cajera no puede
-- leer ni mutar registros de caja aunque intente acceder fuera de la UI.
drop policy if exists "cash_registers_select_admin" on cash_registers;
drop policy if exists "cash_registers_write_admin" on cash_registers;
drop policy if exists "cash_movements_select_admin" on cash_movements;
drop policy if exists "cash_movements_write_admin" on cash_movements;

create policy "cash_registers_select_admin" on cash_registers for select using (current_role_name() = 'admin');
create policy "cash_registers_write_admin" on cash_registers for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');
create policy "cash_movements_select_admin" on cash_movements for select using (current_role_name() = 'admin');
create policy "cash_movements_write_admin" on cash_movements for all using (current_role_name() = 'admin') with check (current_role_name() = 'admin');
