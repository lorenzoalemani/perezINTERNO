import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import PaymentModal from './PaymentModal';
import {
  formatMoney,
  getPeriodRange,
  loadBusinessStats,
  type BusinessStats,
} from '../stats/statsService';
import {
  nextStatusByStatus,
  type OrderWithItems,
  PaymentBadge,
  PrintableOrderTicket,
  StatusBadge,
  statusLabels,
} from './orderHelpers';
import type { OrderItemConfig } from '../../types/database';
import { BURGER_CAPACITY_PER_SLOT, PICKUP_TIME_OPTIONS } from './orderSchedule';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [chargeOrder, setChargeOrder] = useState<OrderWithItems | null>(null);
  const [printOrder, setPrintOrder] = useState<OrderWithItems | null>(null);
  const isPrintingRef = useRef(false);
  const [scheduleCleared, setScheduleCleared] = useState(() => {
    try {
      return localStorage.getItem('scheduleCleared') === todayKey();
    } catch { return false; }
  });

  useEffect(() => {
    loadStats();
  }, [isAdmin]);

  useEffect(() => {
    const state = location.state as { message?: string } | null;
    if (state?.message) {
      setMessage(state.message);
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    const clearPrintOrder = () => {
      setPrintOrder(null);
      isPrintingRef.current = false;
    };
    window.addEventListener('afterprint', clearPrintOrder);
    return () => window.removeEventListener('afterprint', clearPrintOrder);
  }, []);

  const operativeOrders = useMemo(() => {
    if (scheduleCleared) return [];

    const byId = new Map<string, OrderWithItems>();
    for (const order of todayOrders) {
      byId.set(order.id, order);
    }
    return [...byId.values()].sort((a, b) => getOrderSlot(a).localeCompare(getOrderSlot(b)) || a.order_number - b.order_number);
  }, [scheduleCleared, todayOrders]);
  const scheduleRows = useMemo(() => buildScheduleRows(operativeOrders), [operativeOrders]);
  const dailyProduction = useMemo(
    () =>
      operativeOrders.reduce(
        (totals, order) => {
          if (order.status === 'cancelled') return totals;
          const production = getProductionCounts(order);
          return {
            burgers: totals.burgers + production.burgers,
            medallions: totals.medallions + production.medallions,
          };
        },
        { burgers: 0, medallions: 0 }
      ),
    [operativeOrders]
  );

  async function loadStats() {
    setLoading(true);
    setErrorMessage(null);
    setMessage(null);
    try {
      const [businessStats, ordersData] = await Promise.all([
        loadBusinessStats('today', { includeCash: isAdmin }),
        loadDashboardOrders(),
      ]);
      setStats(businessStats);
      setTodayOrders(ordersData.today);
    } catch {
      setErrorMessage('No se pudieron cargar las metricas del dashboard.');
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboardOrders() {
    // La planilla operativa debe usar la misma definicion de "hoy" que las
    // tarjetas del Dashboard. De este modo un pedido creado hoy nunca queda
    // en Pendientes sin aparecer tambien en su horario.
    const period = getPeriodRange('today');
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*)), payments(*)')
      .gte('created_at', period.from)
      .lt('created_at', period.to)
      .order('pickup_time', { ascending: true })
      .limit(500);

    if (error) throw error;

    return {
      today: (data ?? []) as OrderWithItems[],
    };
  }

  function printTicket(order: OrderWithItems) {
    if (isPrintingRef.current) return;
    isPrintingRef.current = true;
    setPrintOrder(order);
    window.setTimeout(() => window.print(), 50);
  }

  async function updateStatus(order: OrderWithItems) {
    const nextAction = nextStatusByStatus[order.status];
    if (!nextAction) return;

    setSavingOrderId(order.id);
    setMessage(null);
    const { error } = await supabase.from('orders').update({ status: nextAction.status }).eq('id', order.id);
    setSavingOrderId(null);

    if (error) {
      setMessage('No se pudo actualizar el estado del pedido.');
      return;
    }

    setMessage(`Pedido #${order.order_number} actualizado a ${statusLabels[nextAction.status]}.`);
    await loadStats();
  }

  async function cancelOrder(order: OrderWithItems) {
    if (order.status === 'cancelled') return;
    if (!window.confirm(`Eliminar el pedido #${order.order_number}? Quedara cancelado en el historial.`)) return;

    setSavingOrderId(order.id);
    setMessage(null);
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    setSavingOrderId(null);

    if (error) {
      setMessage('No se pudo eliminar el pedido.');
      return;
    }

    setMessage(`Pedido #${order.order_number} eliminado/cancelado.`);
    await loadStats();
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <button onClick={() => navigate('/pedidos/nuevo')} className="btn-primary w-full py-5 text-lg sm:py-6 sm:text-xl">
          + NUEVO PEDIDO
        </button>
        <button type="button" onClick={loadStats} className="btn-secondary w-full px-4 py-4 text-base">
          Actualizar
        </button>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {message && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {message}
        </div>
      )}

      {loading || !stats ? (
        <p className="text-gray-500">Cargando estadisticas...</p>
      ) : (
        <>
          <section className="card perez-panel space-y-5 pt-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="perez-kicker">Operacion de hoy</p>
                <h2 className="text-2xl font-black text-gray-950">Dashboard operativo</h2>
                <p className="text-sm text-gray-500">
                  Horarios, capacidad, pedidos, cobro, preparacion e impresion en una sola planilla.
                </p>
              </div>
              <div className="flex justify-start sm:justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const newCleared = !scheduleCleared;
                    setScheduleCleared(newCleared);
                    try {
                      if (newCleared) {
                        localStorage.setItem('scheduleCleared', todayKey());
                      } else {
                        localStorage.removeItem('scheduleCleared');
                      }
                    } catch { /* ignore */ }
                    setMessage(
                      newCleared
                        ? 'Los pedidos fueron limpiados de la planilla.'
                        : 'Los pedidos volvieron a mostrarse en la planilla.'
                    );
                  }}
                  className="min-h-11 rounded-lg border border-red-100 bg-white px-3 py-2 text-sm font-black text-gray-700 hover:border-red-300 hover:text-red-800"
                >
                  {scheduleCleared ? 'Restaurar pedidos' : 'Limpiar pedidos'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MiniMetric label="Hamburguesas del dia" value={String(dailyProduction.burgers)} />
              <MiniMetric label="Medallones del dia" value={String(dailyProduction.medallions)} />
            </div>

            <div className="rounded-lg border border-red-100 bg-white p-3">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <h3 className="font-black text-gray-900">Pedidos por horario</h3>
                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-bold text-red-700">
                  {BURGER_CAPACITY_PER_SLOT} hamburguesas por horario
                </span>
              </div>
              <ScheduleTable
                emptyText="Todavia no hay pedidos para operar hoy."
                rows={scheduleRows}
                savingOrderId={savingOrderId}
                canViewMoney={isAdmin}
                onCancel={cancelOrder}
                onCharge={setChargeOrder}
                onNewOrder={(time) => navigate(`/pedidos/nuevo?pickup=${encodeURIComponent(time)}`)}
                onPrint={printTicket}
                onUpdateStatus={updateStatus}
              />
            </div>
          </section>

          <section className={`grid grid-cols-1 gap-3 min-[430px]:grid-cols-2 sm:gap-4 ${isAdmin ? 'md:grid-cols-3' : ''}`}>
            {isAdmin && <StatCard label="Ventas hoy" value={formatMoney(stats.salesTotal)} highlight />}
            <StatCard label="Pedidos hoy" value={String(stats.validOrderCount)} />
            {isAdmin && <StatCard label="Ticket promedio" value={formatMoney(stats.averageTicket)} />}
            <StatCard label="Pendientes" value={String(stats.activeOrderCount)} />
            {isAdmin && <StatCard label="Efectivo hoy" value={formatMoney(stats.cashTotal)} />}
            {isAdmin && <StatCard label="Transferencias hoy" value={formatMoney(stats.transferTotal)} />}
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            {isAdmin && <div className="card space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold">Caja actual</h2>
                <button type="button" onClick={() => navigate('/caja')} className="text-sm font-semibold text-orange-700">
                  Ver caja
                </button>
              </div>
              {stats.cashSummary ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniMetric label="Efectivo esperado" value={formatMoney(stats.cashSummary.expectedCash)} />
                  <MiniMetric label="Ventas efectivo" value={formatMoney(stats.cashSummary.cashSales)} />
                  <MiniMetric label="Ventas transferencia" value={formatMoney(stats.cashSummary.transferSales)} />
                  <MiniMetric
                    label={stats.cashSummary.isOpen ? 'Estado' : 'Diferencia'}
                    value={
                      stats.cashSummary.isOpen
                        ? 'Abierta'
                        : formatMoney(stats.cashSummary.difference ?? 0)
                    }
                  />
                  {!stats.cashSummary.isOpen && stats.cashSummary.countedCash !== null && (
                    <MiniMetric label="Efectivo contado" value={formatMoney(stats.cashSummary.countedCash)} />
                  )}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-500">
                  No hay caja abierta para hoy.
                </p>
              )}
            </div>}

            <div className="card space-y-4">
              <h2 className="text-xl font-bold">Estado operativo</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(stats.statusCounts).map(([status, count]) => (
                  <MiniMetric key={status} label={statusLabels[status as keyof typeof statusLabels]} value={String(count)} />
                ))}
              </div>
            </div>
          </section>

          <section className="card space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">Productos mas vendidos hoy</h2>
              <button
                type="button"
                onClick={() => navigate('/estadisticas')}
                className="text-sm font-semibold text-orange-700"
              >
                Ver estadisticas
              </button>
            </div>
            {stats.topProductsByQuantity.length === 0 ? (
              <p className="text-sm text-gray-500">Todavia no hay productos vendidos en el periodo.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {stats.topProductsByQuantity.slice(0, 4).map((product, index) => (
                  <div key={product.name} className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
                    <span className="font-semibold">
                      {index + 1}. {product.name}
                    </span>
                    <span className="font-bold">{product.quantity}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {chargeOrder && (
        <PaymentModal
          order={chargeOrder}
          onClose={() => setChargeOrder(null)}
          onPaid={async () => {
            setChargeOrder(null);
            setMessage(`Pedido #${chargeOrder.order_number} cobrado correctamente.`);
            await loadStats();
          }}
        />
      )}

      <PrintableOrderTicket order={printOrder} />
    </div>
  );
}

type ScheduleRow = {
  time: string;
  burgers: number;
  medallions: number;
  available: number;
  percent: number;
  orders: OrderWithItems[];
};

function buildScheduleRows(orders: OrderWithItems[]): ScheduleRow[] {
  const rowsByTime = new Map<string, ScheduleRow>(
    PICKUP_TIME_OPTIONS.map((time) => [
      time,
      {
        time,
        burgers: 0,
        medallions: 0,
        available: BURGER_CAPACITY_PER_SLOT,
        percent: 0,
        orders: [],
      },
    ])
  );

  for (const order of orders) {
    const time = getOrderSlot(order);
    if (!PICKUP_TIME_OPTIONS.includes(time)) continue;
    const current = rowsByTime.get(time);
    if (!current) continue;

    if (order.status !== 'cancelled') {
      const production = getProductionCounts(order);
      current.burgers += production.burgers;
      current.medallions += production.medallions;
    }
    current.available = Math.max(0, BURGER_CAPACITY_PER_SLOT - current.burgers);
    current.percent = Math.min(100, (current.burgers / BURGER_CAPACITY_PER_SLOT) * 100);
    current.orders.push(order);
    rowsByTime.set(time, current);
  }

  return PICKUP_TIME_OPTIONS.map((time) => rowsByTime.get(time)).filter((row): row is ScheduleRow => Boolean(row));
}

function getOrderSlot(order: OrderWithItems) {
  const source = order.pickup_time ?? order.created_at;
  return new Date(source).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function getProductionCounts(order: OrderWithItems) {
  return order.order_items.reduce((totals, item) => {
    const quantity = Number(item.quantity);
    const config = item.item_config as OrderItemConfig | null;
    const isBurger = config?.kind === 'burger' || isBurgerItem(item.product_name_snapshot);
    if (!isBurger) return totals;

    const configuredCapacity = Number(item.capacity_units ?? 0);
    if (configuredCapacity > 0) {
      return { burgers: totals.burgers + quantity, medallions: totals.medallions + configuredCapacity * quantity };
    }
    const baseMeats = config?.kind === 'burger' ? config.totalMeats : 1;
    return { burgers: totals.burgers + quantity, medallions: totals.medallions + baseMeats * quantity };
  }, { burgers: 0, medallions: 0 });
}

function isBurgerItem(productName: string) {
  const normalized = productName.toLowerCase();
  if (
    normalized.includes('papa') ||
    normalized.includes('boniato') ||
    normalized.includes('nugget') ||
    normalized.includes('aro') ||
    normalized.includes('extra carne') ||
    normalized.includes('dip') ||
    normalized.includes('gaseosa') ||
    normalized.includes('agua') ||
    normalized.includes('miller') ||
    normalized.includes('heineken') ||
    normalized.includes('budweiser')
  ) {
    return false;
  }
  return true;
}

function ScheduleTable({
  rows,
  emptyText,
  savingOrderId,
  canViewMoney,
  onCharge,
  onCancel,
  onNewOrder,
  onPrint,
  onUpdateStatus,
}: {
  rows: ScheduleRow[];
  emptyText: string;
  savingOrderId: string | null;
  canViewMoney: boolean;
  onCharge: (order: OrderWithItems) => void;
  onCancel: (order: OrderWithItems) => void;
  onNewOrder: (time: string) => void;
  onPrint: (order: OrderWithItems) => void;
  onUpdateStatus: (order: OrderWithItems) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center text-sm text-gray-500">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="perez-table-head hidden rounded-lg px-3 py-2 text-xs font-black uppercase xl:grid xl:grid-cols-[76px_120px_100px_100px_90px_minmax(220px,1fr)_auto] xl:gap-2">
        <span>Horario</span>
        <span>Carga</span>
        <span>Hamburguesas</span>
        <span>Medallones</span>
        <span>Disponibles</span>
        <span>Pedidos y acciones</span>
        <span>Alta</span>
      </div>
      {rows.map((row) => {
        const isFull = row.available === 0;
        const isHigh = row.percent >= 75;
        return (
          <section
            key={row.time}
            className={`rounded-lg border p-2 ${
              isFull ? 'border-red-200 bg-red-50' : isHigh ? 'border-yellow-200 bg-yellow-50' : 'border-red-100 bg-white'
            }`}
          >
            <div className="grid gap-2 xl:grid-cols-[76px_120px_100px_100px_90px_minmax(220px,1fr)_auto] xl:items-start">
              <div className="flex items-center justify-between gap-2 xl:block">
                <span className="text-xs font-bold uppercase text-gray-500 xl:hidden">Horario</span>
                <span className="text-xl font-black leading-none text-gray-900">{row.time}</span>
              </div>
              <div>
                <div className="h-4 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${isFull ? 'bg-red-700' : isHigh ? 'bg-yellow-500' : 'bg-green-600'}`}
                    style={{ width: `${Math.max(4, row.percent)}%` }}
                  />
                </div>
                <p className="mt-0.5 text-[11px] font-semibold text-gray-500">{row.percent.toFixed(0)}% ocupado</p>
              </div>
              <CompactCell label="Hamburguesas" value={String(row.burgers)} />
              <CompactCell label="Medallones" value={String(row.medallions)} />
              <CompactCell
                label="Disponibles"
                value={String(row.available)}
                className={isFull ? 'text-red-700' : 'text-green-700'}
              />
              <div className="grid gap-1.5">
                {row.orders.length === 0 ? (
                  <p className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-400">
                    Sin pedidos
                  </p>
                ) : (
                  row.orders.map((order) => (
                    <OrderOperationRow
                      key={order.id}
                      isSaving={savingOrderId === order.id}
                      canViewMoney={canViewMoney}
                      order={order}
                      onCancel={onCancel}
                      onCharge={onCharge}
                      onPrint={onPrint}
                      onUpdateStatus={onUpdateStatus}
                    />
                  ))
                )}
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => onNewOrder(row.time)}
                  className="w-full rounded-md bg-red-700 px-2 py-2 text-xs font-black text-white hover:bg-red-800"
                >
                  + Nuevo pedido
                </button>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function CompactCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 xl:block">
      <span className="text-xs font-bold uppercase text-gray-500 xl:hidden">{label}</span>
      <span className={`text-base font-black ${className}`}>{value}</span>
    </div>
  );
}

function OrderOperationRow({
  order,
  isSaving,
  canViewMoney,
  onCharge,
  onCancel,
  onPrint,
  onUpdateStatus,
}: {
  order: OrderWithItems;
  isSaving: boolean;
  canViewMoney: boolean;
  onCharge: (order: OrderWithItems) => void;
  onCancel: (order: OrderWithItems) => void;
  onPrint: (order: OrderWithItems) => void;
  onUpdateStatus: (order: OrderWithItems) => void;
}) {
  const nextAction = nextStatusByStatus[order.status];

  return (
    <div className="rounded-md border border-red-100 bg-white p-2 shadow-sm">
      <div className={`grid gap-2 ${canViewMoney ? '2xl:grid-cols-[82px_minmax(150px,1fr)_120px_120px_86px_minmax(300px,auto)]' : '2xl:grid-cols-[82px_minmax(150px,1fr)_120px_120px_minmax(300px,auto)]'} 2xl:items-center`}>
        <div className="flex items-center justify-between gap-2 2xl:block">
          <p className="text-base font-black text-red-800">#{order.order_number}</p>
          <p className="text-[11px] font-semibold text-gray-500">{getProductionCounts(order).burgers} hamb. · {getProductionCounts(order).medallions} med.</p>
        </div>
        <div>
          <p className="text-sm font-bold leading-tight text-gray-900">{order.customer_name}</p>
          <p className="mt-0.5 line-clamp-1 text-[11px] text-gray-500">
            {order.order_items.map((item) => `${item.quantity}x ${item.product_name_snapshot}`).join(', ')}
          </p>
        </div>
        <StatusBadge status={order.status} />
        <PaymentBadge status={order.payment_status} />
        {canViewMoney && <p className="text-sm font-black">{formatMoney(Number(order.total))}</p>}
        <div className="flex flex-wrap justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onPrint(order)}
            className="rounded-md border border-red-100 px-2 py-1.5 text-xs font-bold text-gray-700 hover:border-red-300 hover:bg-red-50"
          >
            Imprimir
          </button>
          {order.payment_status === 'pending' && (
            <button
              type="button"
              onClick={() => onCharge(order)}
              className="rounded-md bg-green-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-green-700"
            >
              Cobrar
            </button>
          )}
          {nextAction && (
            <button
              type="button"
              onClick={() => onUpdateStatus(order)}
              disabled={isSaving}
              className="rounded-md bg-red-700 px-2 py-1.5 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-50"
            >
              {isSaving ? '...' : nextAction.label}
            </button>
          )}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <button
              type="button"
              onClick={() => onCancel(order)}
              disabled={isSaving}
              className="rounded-md border border-red-200 bg-white px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Eliminar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className={`card ${highlight ? 'border-red-200 bg-red-50' : ''}`}>
      <p className="text-sm font-semibold text-gray-500">{label}</p>
      <p className="text-2xl font-black text-gray-900">{value}</p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="perez-metric">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-bold text-gray-900">{value}</p>
    </div>
  );
}
