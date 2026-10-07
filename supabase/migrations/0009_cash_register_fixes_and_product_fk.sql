-- ==============================================================================
-- Migración: Corregir FK de productos, eliminar restricción UNIQUE en caja diaria
-- y políticas de actualización/eliminación de cajas cerradas
-- ==============================================================================

-- 1. Permitir que al eliminar un producto, sus items históricos en pedidos no bloqueen
--    y se mantengan con product_id = null (el nombre y precio ya están en snapshot).
alter table order_items
  drop constraint if exists order_items_product_id_fkey;

alter table order_items
  add constraint order_items_product_id_fkey
  foreign key (product_id) references products(id) on delete set null;

-- 2. Permitir abrir más de una caja en el mismo día (remover UNIQUE en business_date)
alter table cash_registers
  drop constraint if exists cash_registers_business_date_key;

-- 3. Permitir a administradores editar y eliminar cajas (incluso si ya están cerradas)
drop policy if exists "cash_registers_update_staff" on cash_registers;
drop policy if exists "cash_registers_delete_staff" on cash_registers;

create policy "cash_registers_update_staff" on cash_registers for update
  using (current_role_name() = 'admin' or (current_role_name() = 'counter' and closed_at is null))
  with check (current_role_name() in ('admin', 'counter'));

create policy "cash_registers_delete_staff" on cash_registers for delete
  using (current_role_name() = 'admin');

-- 4. Permitir eliminar movimientos de caja al eliminar la caja
drop policy if exists "cash_movements_delete_admin" on cash_movements;
create policy "cash_movements_delete_admin" on cash_movements for delete
  using (current_role_name() = 'admin');
