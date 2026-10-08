import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../../lib/supabase';
import type { CashMovement, CashRegister, Payment } from '../../types/database';

type Message = { type: 'success' | 'error'; text: string };
type MovementType = 'income' | 'expense';

type RegisterSummary = {
  register: CashRegister;
  cashSales: number;
  transferSales: number;
  manualIncome: number;
  expenses: number;
  expectedCash: number;
  totalSold: number;
};

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function parseAmount(value: string) {
  return Number(value.replace(/\./g, '').replace(',', '.'));
}

function todayBusinessDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dayRange(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-AR');
}

function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function calculateSummary(register: CashRegister, payments: Payment[], movements: CashMovement[]): RegisterSummary {
  const cashSales = payments
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const transferSales = payments
    .filter((payment) => payment.method === 'transfer')
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const manualIncome = movements
    .filter((movement) => movement.type === 'income')
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const expenses = movements
    .filter((movement) => movement.type === 'expense')
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const expectedCash = Number(register.opening_amount) + cashSales + manualIncome - expenses;

  return {
    register,
    cashSales,
    transferSales,
    manualIncome,
    expenses,
    expectedCash,
    totalSold: cashSales + transferSales,
  };
}

export default function CashPage() {
  const { profile } = useAuth();
  const businessDate = todayBusinessDate();
  const [register, setRegister] = useState<CashRegister | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [history, setHistory] = useState<RegisterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [openingAmount, setOpeningAmount] = useState('');
  const [movementType, setMovementType] = useState<MovementType>('income');
  const [movementAmount, setMovementAmount] = useState('');
  const [movementDescription, setMovementDescription] = useState('');
  const [closingAmount, setClosingAmount] = useState('');

  useEffect(() => {
    loadCashData();
  }, []);

  async function loadCashData() {
    setLoading(true);
    setMessage(null);

    const range = dayRange(businessDate);
    const [registerResult, paymentsResult] = await Promise.all([
      supabase.from('cash_registers').select('*').eq('business_date', businessDate).order('opened_at', { ascending: false }),
      supabase.from('payments').select('*').gte('created_at', range.from).lt('created_at', range.to),
    ]);

    if (registerResult.error || paymentsResult.error) {
      const err = registerResult.error ?? paymentsResult.error;
      setMessage({ type: 'error', text: `No se pudo cargar la caja del dia: ${err?.message}` });
      setLoading(false);
      return;
    }

    const registers = (registerResult.data as CashRegister[] | null) ?? [];
    const openRegister = registers.find((r) => !r.closed_at);
    const currentRegister = openRegister ?? (registers.length > 0 ? registers[0] : null);
    setRegister(currentRegister);

    const allPayments = (paymentsResult.data ?? []) as Payment[];
    if (currentRegister) {
      const regOpenTime = new Date(currentRegister.opened_at).getTime();
      const regCloseTime = currentRegister.closed_at ? new Date(currentRegister.closed_at).getTime() : Infinity;
      const currentPayments = allPayments.filter((p) => {
        const pTime = new Date(p.created_at).getTime();
        return pTime >= regOpenTime && pTime <= regCloseTime;
      });
      setPayments(currentPayments);
    } else {
      setPayments([]);
    }

    if (currentRegister) {
      const { data, error } = await supabase
        .from('cash_movements')
        .select('*')
        .eq('register_id', currentRegister.id)
        .order('created_at', { ascending: false });

      if (error) {
        setMessage({ type: 'error', text: 'No se pudieron cargar los movimientos de caja.' });
      } else {
        setMovements((data ?? []) as CashMovement[]);
      }
    } else {
      setMovements([]);
    }

    await loadHistory();
    setLoading(false);
  }

  async function loadHistory() {
    const { data, error } = await supabase
      .from('cash_registers')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(20);

    if (error) return;

    const registers = (data ?? []) as CashRegister[];
    const summaries = await Promise.all(
      registers.map(async (cashRegister) => {
        const regOpen = cashRegister.opened_at;
        const regClose = cashRegister.closed_at || new Date().toISOString();
        const [paymentsResult, movementsResult] = await Promise.all([
          supabase
            .from('payments')
            .select('*')
            .gte('created_at', regOpen)
            .lte('created_at', regClose),
          supabase.from('cash_movements').select('*').eq('register_id', cashRegister.id),
        ]);
        return calculateSummary(
          cashRegister,
          (paymentsResult.data ?? []) as Payment[],
          (movementsResult.data ?? []) as CashMovement[]
        );
      })
    );
    setHistory(summaries);
  }

  const [editingRegister, setEditingRegister] = useState<RegisterSummary | null>(null);
  const [editClosingAmount, setEditClosingAmount] = useState('');

  async function openRegister(event: FormEvent) {
    event.preventDefault();
    if (!profile) {
      setMessage({ type: 'error', text: 'La sesion expiro. Vuelve a iniciar sesion.' });
      return;
    }

    const amount = parseAmount(openingAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setMessage({ type: 'error', text: 'Ingresa un monto inicial valido.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('cash_registers').insert({
      business_date: businessDate,
      opening_amount: amount,
      opened_by: profile.id,
    });
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: `No se pudo abrir la caja: ${error.message}` });
      return;
    }

    setOpeningAmount('');
    setMessage({ type: 'success', text: 'Caja abierta correctamente.' });
    await loadCashData();
  }

  async function deleteRegister(reg: CashRegister) {
    if (!window.confirm(`¿Seguro que deseas eliminar la caja del ${formatDate(reg.business_date)}? Esta acción eliminará también sus movimientos asociados.`)) {
      return;
    }

    setSaving(true);
    setMessage(null);

    // Delete movements first
    await supabase.from('cash_movements').delete().eq('register_id', reg.id);

    const { error } = await supabase.from('cash_registers').delete().eq('id', reg.id);
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: `No se pudo eliminar la caja: ${error.message}` });
      return;
    }

    setMessage({ type: 'success', text: 'Caja eliminada correctamente.' });
    await loadCashData();
  }

  function startEditRegister(summaryItem: RegisterSummary) {
    setEditingRegister(summaryItem);
    setEditClosingAmount(
      summaryItem.register.closing_amount !== null ? String(summaryItem.register.closing_amount) : ''
    );
  }

  async function saveEditRegister(event: FormEvent) {
    event.preventDefault();
    if (!editingRegister) return;

    const counted = parseAmount(editClosingAmount);
    if (!Number.isFinite(counted) || counted < 0) {
      setMessage({ type: 'error', text: 'Ingresa un monto contado valido.' });
      return;
    }

    const difference = counted - editingRegister.expectedCash;

    setSaving(true);
    const { error } = await supabase
      .from('cash_registers')
      .update({
        closing_amount: counted,
        closing_difference_amount: difference,
      })
      .eq('id', editingRegister.register.id);

    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: `No se pudo actualizar la caja: ${error.message}` });
      return;
    }

    setEditingRegister(null);
    setMessage({ type: 'success', text: 'Caja actualizada correctamente.' });
    await loadCashData();
  }

  async function createMovement(event: FormEvent) {
    event.preventDefault();
    if (!profile || !register) return;
    if (register.closed_at) {
      setMessage({ type: 'error', text: 'La caja esta cerrada. No se pueden registrar nuevos movimientos.' });
      return;
    }

    const amount = parseAmount(movementAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setMessage({ type: 'error', text: 'El monto del movimiento debe ser mayor a cero.' });
      return;
    }
    if (!movementDescription.trim()) {
      setMessage({ type: 'error', text: 'Agrega una descripcion para el movimiento.' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('cash_movements').insert({
      register_id: register.id,
      type: movementType,
      amount,
      description: movementDescription.trim(),
      created_by: profile.id,
    });
    setSaving(false);

    if (error) {
      setMessage({ type: 'error', text: 'No se pudo registrar el movimiento.' });
      return;
    }

    setMovementAmount('');
    setMovementDescription('');
    setMessage({ type: 'success', text: 'Movimiento registrado correctamente.' });
    await loadCashData();
  }

  async function closeRegister(event: FormEvent) {
    event.preventDefault();
    if (!profile || !register || !summary) return;
    if (register.closed_at) return;

    const counted = parseAmount(closingAmount);
    if (!Number.isFinite(counted) || counted < 0) {
      setMessage({ type: 'error', text: 'Ingresa el efectivo contado.' });
      return;
    }

    const difference = counted - summary.expectedCash;
    if (!window.confirm(`Cerrar caja con diferencia de ${formatMoney(difference)}?`)) return;

    setSaving(true);
    const closePayload = {
      closing_amount: counted,
      closing_difference_amount: difference,
      closed_by: profile.id,
      closed_at: new Date().toISOString(),
    };

    let closeResult = await supabase
      .from('cash_registers')
      .update(closePayload)
      .eq('id', register.id)
      .is('closed_at', null)
      .select()
      .maybeSingle();

    if (closeResult.error && closeResult.error.message.includes('closing_difference_amount')) {
      closeResult = await supabase
        .from('cash_registers')
        .update({
          closing_amount: counted,
          closed_by: profile.id,
          closed_at: closePayload.closed_at,
        })
        .eq('id', register.id)
        .is('closed_at', null)
        .select()
        .maybeSingle();
    }

    setSaving(false);

    if (closeResult.error) {
      setMessage({ type: 'error', text: `No se pudo cerrar la caja: ${closeResult.error.message}` });
      return;
    }

    if (!closeResult.data) {
      setMessage({
        type: 'error',
        text: 'No se pudo cerrar la caja. Puede que ya este cerrada o que tu usuario no tenga permisos.',
      });
      return;
    }

    setClosingAmount('');
    setRegister(closeResult.data as CashRegister);
    setMessage({ type: 'success', text: 'Caja cerrada correctamente.' });
    await loadCashData();
  }

  const summary = useMemo(
    () => (register ? calculateSummary(register, payments, movements) : null),
    [register, payments, movements]
  );

  const closingCounted = parseAmount(closingAmount);
  const closingDifference = summary && Number.isFinite(closingCounted) ? closingCounted - summary.expectedCash : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Caja del dia</h1>
          <p className="text-sm text-gray-500">Fecha: {formatDate(businessDate)}</p>
        </div>
        <button type="button" onClick={loadCashData} className="btn-secondary px-4 py-3 text-base">
          Actualizar
        </button>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="card py-12 text-center text-gray-500">Cargando caja...</div>
      ) : !register || register.closed_at ? (
        <form onSubmit={openRegister} className="card max-w-xl space-y-4">
          <div>
            <h2 className="text-xl font-bold">Abrir caja</h2>
            <p className="text-sm text-gray-500">
              {register?.closed_at
                ? 'La caja anterior fue cerrada. Podes abrir una nueva.'
                : 'Registra el efectivo inicial. No cuenta como venta.'}
            </p>
          </div>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Monto inicial</span>
            <input
              value={openingAmount}
              onChange={(event) => setOpeningAmount(event.target.value)}
              inputMode="decimal"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-xl font-bold"
              placeholder="0"
            />
          </label>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Abriendo...' : 'Abrir caja'}
          </button>
        </form>
      ) : summary ? (
        <>
          <section className="grid gap-4 md:grid-cols-3">
            <Metric label="Monto inicial" value={summary.register.opening_amount} />
            <Metric label="Ventas efectivo" value={summary.cashSales} highlight />
            <Metric label="Ventas transferencia" value={summary.transferSales} />
            <Metric label="Ingresos manuales" value={summary.manualIncome} />
            <Metric label="Egresos" value={summary.expenses} danger />
            <Metric label="Total vendido" value={summary.totalSold} />
          </section>

          <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
            <div className="card space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Resumen</h2>
                  <p className="text-sm text-gray-500">
                    {register.closed_at ? `Caja cerrada: ${formatDateTime(register.closed_at)}` : 'Caja abierta'}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-sm font-bold ${
                    register.closed_at ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800'
                  }`}
                >
                  {register.closed_at ? 'Cerrada' : 'Abierta'}
                </span>
              </div>

              <div className="rounded-lg bg-orange-50 p-5">
                <p className="text-sm font-semibold uppercase text-orange-800">Efectivo esperado</p>
                <p className="text-4xl font-black text-gray-900">{formatMoney(summary.expectedCash)}</p>
                <p className="mt-2 text-sm text-gray-600">
                  Apertura + ventas efectivo + ingresos - egresos. Las transferencias no entran en caja fisica.
                </p>
              </div>

              {register.closed_at && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric label="Efectivo contado" value={Number(register.closing_amount ?? 0)} />
                  <Metric
                    label={Number(register.closing_difference_amount ?? 0) < 0 ? 'Faltante' : 'Sobrante'}
                    value={Math.abs(Number(register.closing_difference_amount ?? 0))}
                    danger={Number(register.closing_difference_amount ?? 0) < 0}
                    highlight={Number(register.closing_difference_amount ?? 0) >= 0}
                  />
                </div>
              )}

              <div>
                <h3 className="mb-3 font-bold">Movimientos manuales</h3>
                {movements.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500">
                    Sin movimientos manuales.
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {movements.map((movement) => (
                      <div key={movement.id} className="flex items-center justify-between gap-3 p-3">
                        <div>
                          <p className="font-semibold">{movement.description}</p>
                          <p className="text-sm text-gray-500">{formatDateTime(movement.created_at)}</p>
                        </div>
                        <p className={`font-bold ${movement.type === 'expense' ? 'text-red-700' : 'text-green-700'}`}>
                          {movement.type === 'expense' ? '-' : '+'}
                          {formatMoney(Number(movement.amount))}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              {!register.closed_at && (
                <form onSubmit={createMovement} className="card space-y-4">
                  <h2 className="text-xl font-bold">Nuevo movimiento</h2>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMovementType('income')}
                      className={`rounded-lg border-2 px-3 py-3 font-bold ${
                        movementType === 'income' ? 'border-green-500 bg-green-50 text-green-800' : 'border-gray-200'
                      }`}
                    >
                      Ingreso
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovementType('expense')}
                      className={`rounded-lg border-2 px-3 py-3 font-bold ${
                        movementType === 'expense' ? 'border-red-500 bg-red-50 text-red-800' : 'border-gray-200'
                      }`}
                    >
                      Egreso
                    </button>
                  </div>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Monto</span>
                    <input
                      value={movementAmount}
                      onChange={(event) => setMovementAmount(event.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Descripcion</span>
                    <input
                      value={movementDescription}
                      onChange={(event) => setMovementDescription(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
                    />
                  </label>
                  <button type="submit" disabled={saving} className="btn-primary w-full">
                    Registrar movimiento
                  </button>
                </form>
              )}

              {!register.closed_at && (
                <form onSubmit={closeRegister} className="card space-y-4">
                  <h2 className="text-xl font-bold">Cerrar caja</h2>
                  <div className="rounded-lg bg-gray-50 p-4">
                    <p className="text-sm font-semibold text-gray-500">Efectivo esperado</p>
                    <p className="text-2xl font-black">{formatMoney(summary.expectedCash)}</p>
                  </div>
                  <label className="block">
                    <span className="text-sm font-semibold text-gray-700">Efectivo contado</span>
                    <input
                      value={closingAmount}
                      onChange={(event) => setClosingAmount(event.target.value)}
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-xl font-bold"
                    />
                  </label>
                  {closingDifference !== null && (
                    <div className="rounded-lg bg-gray-50 p-4">
                      <p className={`text-xl font-bold ${closingDifference < 0 ? 'text-red-700' : 'text-green-700'}`}>
                        {closingDifference < 0 ? 'Faltante' : 'Sobrante'}:{' '}
                        {formatMoney(Math.abs(closingDifference))}
                      </p>
                    </div>
                  )}
                  <button type="submit" disabled={saving} className="btn-primary w-full">
                    Cerrar caja
                  </button>
                </form>
              )}
            </aside>
          </section>
        </>
      ) : null}

      <section className="card space-y-4">
        <h2 className="text-xl font-bold">Historial de cajas</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-500">Todavia no hay cajas registradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-3">Fecha</th>
                  <th className="px-3 py-3">Apertura</th>
                  <th className="px-3 py-3">Efectivo</th>
                  <th className="px-3 py-3">Transferencia</th>
                  <th className="px-3 py-3">Ingresos</th>
                  <th className="px-3 py-3">Egresos</th>
                  <th className="px-3 py-3">Esperado</th>
                  <th className="px-3 py-3">Contado</th>
                  <th className="px-3 py-3">Diferencia</th>
                  <th className="px-3 py-3">Estado</th>
                  <th className="px-3 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((item) => (
                  <tr key={item.register.id}>
                    <td className="px-3 py-3 font-semibold">{formatDate(item.register.business_date)}</td>
                    <td className="px-3 py-3">{formatMoney(Number(item.register.opening_amount))}</td>
                    <td className="px-3 py-3">{formatMoney(item.cashSales)}</td>
                    <td className="px-3 py-3">{formatMoney(item.transferSales)}</td>
                    <td className="px-3 py-3">{formatMoney(item.manualIncome)}</td>
                    <td className="px-3 py-3">{formatMoney(item.expenses)}</td>
                    <td className="px-3 py-3 font-semibold">{formatMoney(item.expectedCash)}</td>
                    <td className="px-3 py-3">
                      {item.register.closing_amount === null ? '-' : formatMoney(Number(item.register.closing_amount))}
                    </td>
                    <td className="px-3 py-3">
                      {item.register.closing_difference_amount === null
                        ? '-'
                        : formatMoney(Number(item.register.closing_difference_amount))}
                    </td>
                    <td className="px-3 py-3">{item.register.closed_at ? 'Cerrada' : 'Abierta'}</td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        {item.register.closed_at && (
                          <button
                            type="button"
                            onClick={() => startEditRegister(item)}
                            className="rounded border border-gray-300 px-2 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                          >
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => deleteRegister(item.register)}
                          className="rounded border border-red-200 px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {editingRegister && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">
              Editar caja del {formatDate(editingRegister.register.business_date)}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              Efectivo esperado por el sistema: {formatMoney(editingRegister.expectedCash)}
            </p>

            <form onSubmit={saveEditRegister} className="mt-4 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700">
                  Efectivo contado al cierre
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editClosingAmount}
                  onChange={(e) => setEditClosingAmount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-lg font-bold"
                  placeholder="0"
                  autoFocus
                />
              </div>

              {Number.isFinite(parseAmount(editClosingAmount)) && (
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <span className="text-gray-500">Nueva diferencia estimada: </span>
                  <span
                    className={`font-bold ${
                      parseAmount(editClosingAmount) - editingRegister.expectedCash < 0
                        ? 'text-red-600'
                        : 'text-green-600'
                    }`}
                  >
                    {formatMoney(parseAmount(editClosingAmount) - editingRegister.expectedCash)}
                  </span>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingRegister(null)}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: number;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        danger
          ? 'border-red-200 bg-red-50'
          : highlight
            ? 'border-green-200 bg-green-50'
            : 'border-gray-200 bg-white'
      }`}
    >
      <p className="text-sm font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-gray-900">{formatMoney(value)}</p>
    </div>
  );
}
