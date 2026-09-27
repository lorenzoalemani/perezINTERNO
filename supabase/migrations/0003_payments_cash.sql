-- Etapa 5: pagos y caja diaria

alter table cash_registers
  add column if not exists closing_difference_amount numeric(10,2);

alter table cash_movements
  add constraint cash_movements_amount_positive check (amount > 0);

create index if not exists idx_cash_registers_business_date on cash_registers(business_date);
create index if not exists idx_cash_movements_register_id on cash_movements(register_id);

create or replace function close_order_with_payment(
  p_order_id uuid,
  p_method text,
  p_amount numeric,
  p_received_amount numeric default null
) returns orders as $$
declare
  v_order orders;
  v_received numeric(10,2);
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

  if p_amount <> v_order.total then
    raise exception 'El monto no coincide con el total del pedido';
  end if;

  if p_method = 'cash' then
    v_received := coalesce(p_received_amount, 0);
    if v_received < v_order.total then
      raise exception 'El monto recibido es insuficiente';
    end if;
  else
    v_received := null;
  end if;

  insert into payments (order_id, method, amount, received_amount, change_amount, received_by)
  values (
    p_order_id,
    p_method,
    v_order.total,
    v_received,
    case when p_method = 'cash' then v_received - v_order.total else null end,
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

drop policy if exists "cash_registers_select_admin" on cash_registers;
drop policy if exists "cash_registers_write_admin" on cash_registers;
drop policy if exists "cash_movements_select_admin" on cash_movements;
drop policy if exists "cash_movements_write_admin" on cash_movements;

create policy "cash_registers_select_staff" on cash_registers for select
  using (current_role_name() in ('admin', 'counter'));

create policy "cash_registers_insert_staff" on cash_registers for insert
  with check (current_role_name() in ('admin', 'counter') and opened_by = auth.uid());

create policy "cash_registers_update_staff" on cash_registers for update
  using (current_role_name() in ('admin', 'counter') and closed_at is null)
  with check (current_role_name() in ('admin', 'counter'));

create policy "cash_movements_select_staff" on cash_movements for select
  using (current_role_name() in ('admin', 'counter'));

create policy "cash_movements_insert_staff_open_register" on cash_movements for insert
  with check (
    current_role_name() in ('admin', 'counter')
    and created_by = auth.uid()
    and exists (
      select 1 from cash_registers cr
      where cr.id = register_id and cr.closed_at is null
    )
  );
