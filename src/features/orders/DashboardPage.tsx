import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/AuthContext';
import PaymentModal from './PaymentModal';
import {
  formatMoney,
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
  const [hasOpenRegister, setHasOpenRegister] = useState<boolean>(true);
  const [openRegisterId, setOpenRegisterId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showClearFinalConfirm, setShowClearFinalConfirm] = useState(false);
  const [clearingOrders, setClearingOrders] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [_deletingOrderId, setDeletingOrderId] = useState<string | null>(null);

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
    const byId = new Map<string, OrderWithItems>();
    for (const order of todayOrders) {
      // Disappear completely if cancelled
      if (order.status === 'cancelled') {
        continue;
      }
      byId.set(order.id, order);
    }
    return [...byId.values()].sort((a, b) => getOrderSlot(a).localeCompare(getOrderSlot(b)) || a.order_number - b.order_number);
  }, [todayOrders]);
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

  const burgerVarieties = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of operativeOrders) {
      if (order.status === 'cancelled') continue;
      for (const item of order.order_items) {
        const config = item.item_config as OrderItemConfig | null;
        const isBurger = config?.kind === 'burger' || isBurgerItem(item.product_name_snapshot);
        if (!isBurger) continue;
        const name = item.product_name_snapshot;
        const qty = Number(item.quantity) || 0;
        counts.set(name, (counts.get(name) ?? 0) + qty);
      }
    }
    return Array.from(counts.entries())
      .filter(([_, qty]) => qty > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [operativeOrders]);

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
    } catch (err) {
      const message = err instanceof Error ? err.message : (err as { message?: string })?.message ?? 'Error desconocido';
      setErrorMessage(`No se pudieron cargar las metricas del dashboard: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  async function loadDashboardOrders() {
    // 1. Consultar si hay caja abierta usando la función RPC
    const { data: regData, error: regError } = await supabase.rpc('has_open_register');
    
    if (regError) throw regError;
    
    const regInfo = regData as { open: boolean; register_id?: string; opened_at?: string; business_date?: string };
    setHasOpenRegister(regInfo.open);
    setOpenRegisterId(regInfo.open && regInfo.register_id ? regInfo.register_id : null);

    if (!regInfo.open || !regInfo.register_id) {
      return { today: [] as OrderWithItems[] };
    }

    // 2. Cargar pedidos por register_id
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*)), payments(*)')
      .eq('register_id', regInfo.register_id)
      .order('pickup_time', { ascending: true })
      .limit(500);

    if (error) throw error;

    return { today: (data ?? []) as OrderWithItems[] };
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
    if (!window.confirm(`¿Cancelar el pedido #${order.order_number}? Quedará marcado como cancelado.`)) return;

    setSavingOrderId(order.id);
    setMessage(null);
    const { error } = await supabase.from('orders').update({ status: 'cancelled' }).eq('id', order.id);
    setSavingOrderId(null);

    if (error) {
      setMessage('No se pudo cancelar el pedido.');
      return;
    }

    setMessage(`Pedido #${order.order_number} cancelado.`);
    await loadStats();
  }

  async function deleteOrderPermanently(orderId: string, orderNumber: number) {
    setDeletingOrderId(orderId);
    setShowDeleteConfirm(null);
    setMessage(null);
    const { error } = await supabase.rpc('delete_order_permanently', { p_order_id: orderId });
    setDeletingOrderId(null);

    if (error) {
      setMessage('No se pudo eliminar el pedido.');
      return;
    }

    setMessage(`Pedido #${orderNumber} eliminado permanentemente.`);
    await loadStats();
  }

  async function handleClearOrders() {
    if (!openRegisterId) return;
    setClearingOrders(true);
    setShowClearFinalConfirm(false);
    setShowClearConfirm(false);
    setMessage(null);
    
    const { data, error } = await supabase.rpc('clear_register_orders', { p_register_id: openRegisterId });
    setClearingOrders(false);

    if (error) {
      setMessage('No se pudieron limpiar los pedidos.');
      return;
    }

    const result = data as { deleted_count: number; deleted_total: number } | null;
    setMessage(`Se eliminaron ${result?.deleted_count ?? 0} pedidos permanentemente.`);
    await loadStats();
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <button
          onClick={() => {
            if (!hasOpenRegister) {
              alert('No hay una caja abierta actualmente. Primero debes abrir una caja para poder cargar pedidos.');
              navigate('/caja');
              return;
            }
            navigate('/pedidos/nuevo');
          }}
          className="btn-primary w-full py-5 text-lg sm:py-6 sm:text-xl"
        >
          + NUEVO PEDIDO
        </button>
        <button type="button" onClick={loadStats} className="btn-secondary w-full px-4 py-4 text-base">
          Actualizar
        </button>
      </div>

      {!hasOpenRegister && (
        <div className="flex flex-col gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-4 sm:flex-row sm:items-center sm:justify-between text-red-900">
          <div>
            <p className="font-black text-base">⚠️ La caja se encuentra cerrada</p>
            <p className="text-sm font-semibold text-red-700">
              Para poder cargar pedidos y operar, primero debes abrir una caja en la sección de Caja.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/caja')}
            className="rounded-lg bg-red-700 px-4 py-2 font-black text-white hover:bg-red-800 shrink-0 text-sm"
          >
            Ir a abrir caja
          </button>
        </div>
      )}

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
                  disabled={clearingOrders || operativeOrders.length === 0}
                  onClick={() => setShowClearConfirm(true)}
                  className="min-h-11 rounded-lg border-2 border-red-300 bg-white px-3 py-2 text-sm font-black text-red-700 hover:border-red-500 hover:bg-red-50 disabled:opacity-50"
                >
                  {clearingOrders ? 'Limpiando...' : '🗑️ Limpiar pedidos'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <MiniMetric label="Hamburguesas del dia" value={String(dailyProduction.burgers)} />
              <MiniMetric label="Medallones del dia" value={String(dailyProduction.medallions)} />
            </div>

            {burgerVarieties.length > 0 && (
              <div className="rounded-xl border border-red-100 bg-white p-3.5 shadow-sm">
                <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2.5">
                  Variedades de hamburguesas
                </p>
                <div className="flex flex-wrap gap-2">
                  {burgerVarieties.map(([name, count]) => (
                    <div
                      key={name}
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50/50 px-3 py-1.5 text-sm font-bold text-gray-900"
                    >
                      <span>{name}:</span>
                      <span className="rounded-md bg-red-700 px-2 py-0.5 text-xs font-black text-white">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                onDelete={(order) => setShowDeleteConfirm(order.id)}
                onCharge={setChargeOrder}
                onNewOrder={(time) => {
                  if (!hasOpenRegister) {
                    alert('No hay una caja abierta actualmente. Primero debes abrir una caja para poder cargar pedidos.');
                    navigate('/caja');
                    return;
                  }
                  navigate(`/pedidos/nuevo?pickup=${encodeURIComponent(time)}`);
                }}
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

      {/* Modal: Confirmar limpieza de pedidos - Paso 1 */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border-2 border-red-300">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
                <span className="text-3xl">⚠️</span>
              </div>
              <h3 className="text-xl font-black text-red-800">¿Limpiar TODOS los pedidos?</h3>
              <p className="mt-3 text-sm text-gray-600">
                Esto eliminará <strong className="text-red-700">permanentemente</strong> todos los pedidos de la caja actual, incluyendo sus pagos.
              </p>
              <p className="mt-2 text-sm font-bold text-red-700">
                Los pedidos cobrados se restarán de la caja. Esta acción NO se puede deshacer.
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowClearConfirm(false);
                  setShowClearFinalConfirm(true);
                }}
                className="flex-1 rounded-lg bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800"
              >
                Sí, continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar limpieza de pedidos - Paso 2 (confirmación final) */}
      {showClearFinalConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl border-4 border-red-500">
            <div className="text-center">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-600">
                <span className="text-3xl text-white">🚨</span>
              </div>
              <h3 className="text-xl font-black text-red-900">ÚLTIMA CONFIRMACIÓN</h3>
              <p className="mt-3 text-base font-bold text-red-800">
                Hay {operativeOrders.length} pedido(s) que serán eliminados para siempre.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                ¿Estás completamente seguro? No podrás recuperarlos.
              </p>
            </div>
            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowClearFinalConfirm(false)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                No, cancelar
              </button>
              <button
                type="button"
                onClick={handleClearOrders}
                className="flex-1 rounded-lg bg-red-800 px-4 py-3 text-sm font-black text-white hover:bg-red-900 ring-2 ring-red-400"
              >
                CONFIRMAR ELIMINACIÓN
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Confirmar eliminación individual */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl border-2 border-red-300">
            <h3 className="text-lg font-black text-red-800">¿Eliminar este pedido?</h3>
            <p className="mt-2 text-sm text-gray-600">
              El pedido será eliminado permanentemente de la base de datos junto con sus pagos. No se puede deshacer.
            </p>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-3 text-sm font-bold text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  const order = todayOrders.find(o => o.id === showDeleteConfirm);
                  if (order) deleteOrderPermanently(order.id, order.order_number);
                }}
                className="flex-1 rounded-lg bg-red-700 px-4 py-3 text-sm font-black text-white hover:bg-red-800"
              >
                Eliminar permanentemente
              </button>
            </div>
          </div>
        </div>
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
  onDelete,
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
  onDelete: (order: OrderWithItems) => void;
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
    <div className="space-y-3">
      {rows.map((row) => {
        const isFull = row.available === 0;
        const isHigh = row.percent >= 75;
        return (
          <section
            key={row.time}
            className={`rounded-xl border p-3 sm:p-4 shadow-sm transition ${
              isFull ? 'border-red-200 bg-red-50/70' : isHigh ? 'border-yellow-200 bg-yellow-50/70' : 'border-gray-200 bg-white'
            }`}
          >
            {/* Cabecera del horario con métricas y botón de Nuevo Pedido */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border-b border-gray-100 pb-2.5">
              <div className="flex flex-wrap items-center gap-3 sm:gap-4">
                <span className="text-xl sm:text-2xl font-black text-gray-950 min-w-[70px]">{row.time}</span>
                <div className="w-28 sm:w-36">
                  <div className="h-3 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className={`h-full rounded-full ${isFull ? 'bg-red-700' : isHigh ? 'bg-yellow-500' : 'bg-green-600'}`}
                      style={{ width: `${Math.max(4, row.percent)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] font-semibold text-gray-500">{row.percent.toFixed(0)}% ocupado</p>
                </div>
                <div className="flex items-center gap-2 text-xs font-bold text-gray-600">
                  <span><strong className="text-gray-900">{row.burgers}</strong> hamb.</span>
                </div>
              </div>
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => onNewOrder(row.time)}
                  className="w-full sm:w-auto rounded-lg bg-red-700 px-3.5 py-2 text-xs font-black text-white hover:bg-red-800 shadow-sm"
                >
                  + Nuevo pedido ({row.time})
                </button>
              </div>
            </div>

            {/* Listado de pedidos para este horario */}
            <div className="mt-2.5 space-y-2">
              {row.orders.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-200 bg-gray-50/50 px-3 py-2 text-xs font-semibold text-gray-400">
                  Sin pedidos para este horario
                </p>
              ) : (
                row.orders.map((order) => (
                  <OrderOperationRow
                    key={order.id}
                    isSaving={savingOrderId === order.id}
                    canViewMoney={canViewMoney}
                    order={order}
                    onCancel={onCancel}
                    onDelete={onDelete}
                    onCharge={onCharge}
                    onPrint={onPrint}
                    onUpdateStatus={onUpdateStatus}
                  />
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}


function OrderOperationRow({
  order,
  isSaving,
  canViewMoney,
  onCharge,
  onCancel,
  onDelete,
  onPrint,
  onUpdateStatus,
}: {
  order: OrderWithItems;
  isSaving: boolean;
  canViewMoney: boolean;
  onCharge: (order: OrderWithItems) => void;
  onCancel: (order: OrderWithItems) => void;
  onDelete: (order: OrderWithItems) => void;
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
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(order)}
            disabled={isSaving}
            className="rounded-md border-2 border-red-300 bg-white px-2 py-1.5 text-xs font-black text-red-700 hover:border-red-500 hover:bg-red-50 disabled:opacity-50"
          >
            Eliminar
          </button>
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
