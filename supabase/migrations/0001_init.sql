-- =========================================================
-- HAMBURGUESERÍA - ESQUEMA INICIAL
-- =========================================================

-- ---------- EXTENSIONS ----------
create extension if not exists "pgcrypto";

-- ---------- PROFILES (roles) ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'counter')),
  created_at timestamptz not null default now()
);

-- ---------- CATEGORIES ----------
create table categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- PRODUCTS ----------
create table products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references categories(id),
  name text not null,
  price numeric(10,2) not null check (price >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- MODIFIERS (adicionales / modificaciones) ----------
create table modifiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0,
  type text not null check (type in ('addon', 'modification')), -- addon = con precio, modification = gratis (sin cebolla, etc)
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Qué modificadores están disponibles para qué producto (N:N)
create table product_modifiers (
  product_id uuid not null references products(id) on delete cascade,
  modifier_id uuid not null references modifiers(id) on delete cascade,
  primary key (product_id, modifier_id)
);

-- ---------- ORDER NUMBER SEQUENCE (seguro, sin duplicados) ----------
create sequence order_number_seq start 1;

-- ---------- ORDERS ----------
create table orders (
  id uuid primary key default gen_random_uuid(),
  order_number int not null default nextval('order_number_seq') unique,
  customer_name text not null,
  pickup_time timestamptz,
  status text not null default 'pending'
    check (status in ('pending', 'preparing', 'ready', 'delivered', 'cancelled')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  total numeric(10,2) not null default 0,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  closed_by uuid references profiles(id),
  closed_at timestamptz
);

create index idx_orders_status on orders(status);
create index idx_orders_payment_status on orders(payment_status);
create index idx_orders_created_at on orders(created_at);

-- ---------- ORDER ITEMS (con snapshot de precio/nombre) ----------
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id),
  product_name_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null,
  quantity int not null check (quantity > 0),
  subtotal numeric(10,2) not null,
  created_at timestamptz not null default now()
);

create index idx_order_items_order_id on order_items(order_id);

-- ---------- ORDER ITEM MODIFIERS (snapshot) ----------
create table order_item_modifiers (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references order_items(id) on delete cascade,
  modifier_id uuid references modifiers(id),
  name_snapshot text not null,
  price_snapshot numeric(10,2) not null default 0,
  type_snapshot text not null
);

create index idx_oim_order_item_id on order_item_modifiers(order_item_id);

-- ---------- PAYMENTS ----------
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  method text not null check (method in ('cash', 'transfer')),
  amount numeric(10,2) not null,
  received_amount numeric(10,2), -- para vuelto en efectivo (futuro)
  change_amount numeric(10,2),
  received_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index idx_payments_order_id on payments(order_id);
create index idx_payments_created_at on payments(created_at);

-- ---------- CASH REGISTERS (preparado para futuro, no obligatorio en MVP) ----------
create table cash_registers (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  opened_by uuid references profiles(id),
  opening_amount numeric(10,2) default 0,
  closed_by uuid references profiles(id),
  closing_amount numeric(10,2),
  opened_at timestamptz default now(),
  closed_at timestamptz
);

create table cash_movements (
  id uuid primary key default gen_random_uuid(),
  register_id uuid references cash_registers(id) on delete cascade,
  type text not null check (type in ('income', 'expense')),
  amount numeric(10,2) not null,
  description text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- TRIGGERS
-- =========================================================

-- Mantener updated_at en products
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- =========================================================
-- RPC: crear pedido completo en una transacción
-- (evita pedidos a medio guardar / duplicados por doble clic)
-- =========================================================
create or replace function create_order(
  p_customer_name text,
  p_pickup_time timestamptz,
  p_notes text,
  p_items jsonb -- [{product_id, product_name, unit_price, quantity, modifiers:[{modifier_id,name,price,type}]}]
) returns orders as $$
declare
  v_order orders;
  v_item jsonb;
  v_mod jsonb;
  v_order_item_id uuid;
  v_total numeric(10,2) := 0;
  v_item_subtotal numeric(10,2);
begin
  insert into orders (customer_name, pickup_time, notes, created_by, status, payment_status, total)
  values (p_customer_name, p_pickup_time, p_notes, auth.uid(), 'pending', 'pending', 0)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_item_subtotal := (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;

    -- sumar precio de addons (modificadores con precio) * cantidad
    if v_item ? 'modifiers' then
      select coalesce(sum((m->>'price')::numeric), 0) * (v_item->>'quantity')::int
        into v_item_subtotal
      from jsonb_array_elements(v_item->'modifiers') m;
      v_item_subtotal := v_item_subtotal + (v_item->>'unit_price')::numeric * (v_item->>'quantity')::int;
    end if;

    insert into order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal)
    values (
      v_order.id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      (v_item->>'quantity')::int,
      v_item_subtotal
    )
    returning id into v_order_item_id;

    if v_item ? 'modifiers' then
      for v_mod in select * from jsonb_array_elements(v_item->'modifiers')
      loop
        insert into order_item_modifiers (order_item_id, modifier_id, name_snapshot, price_snapshot, type_snapshot)
        values (
          v_order_item_id,
          (v_mod->>'modifier_id')::uuid,
          v_mod->>'name',
          coalesce((v_mod->>'price')::numeric, 0),
          v_mod->>'type'
        );
      end loop;
    end if;

    v_total := v_total + v_item_subtotal;
  end loop;

  update orders set total = v_total where id = v_order.id returning * into v_order;

  return v_order;
end;
$$ language plpgsql security definer;

-- =========================================================
-- RPC: cerrar pedido con pago
-- =========================================================
create or replace function close_order_with_payment(
  p_order_id uuid,
  p_method text,
  p_amount numeric,
  p_received_amount numeric default null
) returns orders as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order_id for update;

  if v_order.payment_status = 'paid' then
    raise exception 'El pedido ya fue pagado';
  end if;

  insert into payments (order_id, method, amount, received_amount, change_amount, received_by)
  values (
    p_order_id, p_method, p_amount, p_received_amount,
    case when p_received_amount is not null then p_received_amount - p_amount else null end,
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

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table profiles enable row level security;
alter table categories enable row level security;
alter table products enable row level security;
alter table modifiers enable row level security;
alter table product_modifiers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_item_modifiers enable row level security;
alter table payments enable row level security;
alter table cash_registers enable row level security;
alter table cash_movements enable row level security;

-- Helper: rol del usuario actual
create or replace function current_role_name() returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql stable security definer;

-- PROFILES: cada uno ve el suyo, admin ve todos
create policy "profiles_select_own_or_admin" on profiles for select
  using (id = auth.uid() or current_role_name() = 'admin');
create policy "profiles_update_admin" on profiles for update
  using (current_role_name() = 'admin');
create policy "profiles_insert_admin" on profiles for insert
  with check (current_role_name() = 'admin' or id = auth.uid());

-- CATEGORIES / PRODUCTS / MODIFIERS: todos los autenticados leen, solo admin escribe
create policy "categories_select_authenticated" on categories for select
  using (auth.role() = 'authenticated');
create policy "categories_write_admin" on categories for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "products_select_authenticated" on products for select
  using (auth.role() = 'authenticated');
create policy "products_write_admin" on products for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "modifiers_select_authenticated" on modifiers for select
  using (auth.role() = 'authenticated');
create policy "modifiers_write_admin" on modifiers for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "product_modifiers_select_authenticated" on product_modifiers for select
  using (auth.role() = 'authenticated');
create policy "product_modifiers_write_admin" on product_modifiers for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

-- ORDERS / ITEMS: admin y counter pueden ver y crear/editar (mostrador opera pedidos)
create policy "orders_select_authenticated" on orders for select
  using (auth.role() = 'authenticated');
create policy "orders_insert_authenticated" on orders for insert
  with check (auth.role() = 'authenticated');
create policy "orders_update_authenticated" on orders for update
  using (auth.role() = 'authenticated');
-- Nadie borra pedidos (histórico permanente): no se crea policy de delete -> denegado por defecto

create policy "order_items_select_authenticated" on order_items for select
  using (auth.role() = 'authenticated');
create policy "order_items_insert_authenticated" on order_items for insert
  with check (auth.role() = 'authenticated');

create policy "oim_select_authenticated" on order_item_modifiers for select
  using (auth.role() = 'authenticated');
create policy "oim_insert_authenticated" on order_item_modifiers for insert
  with check (auth.role() = 'authenticated');

-- PAYMENTS: autenticados leen/crean, nadie edita/borra un pago ya hecho
create policy "payments_select_authenticated" on payments for select
  using (auth.role() = 'authenticated');
create policy "payments_insert_authenticated" on payments for insert
  with check (auth.role() = 'authenticated');

-- CAJA: solo admin ve movimientos manuales; ambos roles pueden ver totales vía orders/payments igual
create policy "cash_registers_select_admin" on cash_registers for select
  using (current_role_name() = 'admin');
create policy "cash_registers_write_admin" on cash_registers for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

create policy "cash_movements_select_admin" on cash_movements for select
  using (current_role_name() = 'admin');
create policy "cash_movements_write_admin" on cash_movements for all
  using (current_role_name() = 'admin') with check (current_role_name() = 'admin');

-- =========================================================
-- SEED: categorías, productos y modificadores de ejemplo
-- =========================================================
insert into categories (name, sort_order) values
  ('Hamburguesas', 1),
  ('Papas', 2),
  ('Bebidas', 3);

insert into products (category_id, name, price, sort_order)
select id, 'Clásica', 8500, 1 from categories where name = 'Hamburguesas'
union all
select id, 'Cheddar', 9500, 2 from categories where name = 'Hamburguesas'
union all
select id, 'Doble', 11500, 3 from categories where name = 'Hamburguesas'
union all
select id, 'Bacon', 10500, 4 from categories where name = 'Hamburguesas'
union all
select id, 'Especial', 12500, 5 from categories where name = 'Hamburguesas'
union all
select id, 'Papas chicas', 3500, 1 from categories where name = 'Papas'
union all
select id, 'Papas grandes', 5000, 2 from categories where name = 'Papas'
union all
select id, 'Gaseosa', 2500, 1 from categories where name = 'Bebidas'
union all
select id, 'Agua', 2000, 2 from categories where name = 'Bebidas';

insert into modifiers (name, price, type) values
  ('Queso extra', 800, 'addon'),
  ('Bacon extra', 1200, 'addon'),
  ('Huevo', 700, 'addon'),
  ('Sin cebolla', 0, 'modification'),
  ('Sin tomate', 0, 'modification'),
  ('Sin lechuga', 0, 'modification');

-- Asociar todos los modificadores a todas las hamburguesas (simplificación del seed)
insert into product_modifiers (product_id, modifier_id)
select p.id, m.id from products p, modifiers m
join categories c on c.id = p.category_id
where c.name = 'Hamburguesas';
