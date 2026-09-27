import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrderStatus } from '../../types/database';
import PaymentModal from './PaymentModal';
import {
  formatDateTime,
  formatMoney,
  formatTime,
  nextStatusByStatus,
  OrderDetailModal,
  OrderItemsSummary,
  type OrderWithItems,
  PaymentBadge,
  PrintableOrderTicket,
  StatusBadge,
  statusLabels,
} from './orderHelpers';

type Message = { type: 'success' | 'error'; text: string };

const ACTIVE_STATUSES: OrderStatus[] = ['pending', 'preparing', 'ready'];

export default function PendingOrdersPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [chargeOrder, setChargeOrder] = useState<OrderWithItems | null>(null);
  const [printOrder, setPrintOrder] = useState<OrderWithItems | null>(null);
  const isPrintingRef = useRef(false);

  useEffect(() => {
    loadPendingOrders(true);
    const intervalId = window.setInterval(() => loadPendingOrders(false), 30000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const clearPrintOrder = () => {
      setPrintOrder(null);
      isPrintingRef.current = false;
    };
    window.addEventListener('afterprint', clearPrintOrder);
    return () => window.removeEventListener('afterprint', clearPrintOrder);
  }, []);

  function printTicket(order: OrderWithItems) {
    if (isPrintingRef.current) return;
    isPrintingRef.current = true;
    setPrintOrder(order);
    window.setTimeout(() => window.print(), 50);
  }

  async function loadPendingOrders(showLoading = false) {
    if (showLoading) setLoading(true);
    const { data, error } = await supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*)), payments(*)')
      .in('status', ACTIVE_STATUSES)
      .order('created_at', { ascending: true });

    if (error) {
      setMessage({ type: 'error', text: 'No se pudieron cargar los pedidos pendientes.' });
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as OrderWithItems[]);
    setLoading(false);
  }

  async function updateStatus(order: OrderWithItems, nextStatus: OrderStatus) {
    setSavingOrderId(order.id);
    setMessage(null);

    const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', order.id);
    setSavingOrderId(null);

    if (error) {
      setMessage({ type: 'error', text: 'No se pudo actualizar el estado del pedido.' });
      return;
    }

    setMessage({
      type: 'success',
      text: `Pedido #${order.order_number} actualizado a ${statusLabels[nextStatus]}.`,
    });
    await loadPendingOrders(false);
  }

  async function cancelOrder(order: OrderWithItems) {
    if (!window.confirm(`Seguro que queres cancelar el pedido #${order.order_number}?`)) return;
    await updateStatus(order, 'cancelled');
  }

  const selectedOrderFromList = selectedOrder
    ? orders.find((order) => order.id === selectedOrder.id) ?? selectedOrder
    : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos pendientes</h1>
          <p className="text-sm text-gray-500">Pedidos activos ordenados del mas antiguo al mas nuevo.</p>
        </div>
        <button type="button" onClick={() => loadPendingOrders(true)} className="btn-secondary px-4 py-3 text-base">
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
        <div className="card py-12 text-center text-gray-500">Cargando pedidos...</div>
      ) : orders.length === 0 ? (
        <div className="card py-12 text-center">
          <h2 className="text-xl font-bold text-gray-900">No hay pedidos activos</h2>
          <p className="mt-1 text-gray-500">Cuando se creen comandas pendientes van a aparecer aca.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {orders.map((order) => {
            const nextAction = nextStatusByStatus[order.status];
            const isSaving = savingOrderId === order.id;

            return (
              <article key={order.id} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => setSelectedOrder(order)} className="w-full text-left">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase text-orange-600">Pedido</p>
                      <h2 className="text-4xl font-black leading-none text-gray-900">#{order.order_number}</h2>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={order.status} />
                      <PaymentBadge status={order.payment_status} />
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 text-sm sm:grid-cols-3">
                    <Info label="Cliente" value={order.customer_name} />
                    <Info label="Retiro" value={formatTime(order.pickup_time)} />
                    <Info label="Creado" value={formatDateTime(order.created_at)} />
                  </div>

                  <div className="mt-4">
                    <OrderItemsSummary order={order} compact />
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
                    <span className="text-sm font-semibold text-gray-500">Total</span>
                    <span className="text-xl font-bold">{formatMoney(Number(order.total))}</span>
                  </div>
                </button>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => printTicket(order)}
                    disabled={isSaving}
                    className="btn-secondary px-4 py-3 text-base"
                  >
                    Imprimir comanda
                  </button>
                  {order.payment_status === 'pending' && (
                    <button
                      type="button"
                      onClick={() => setChargeOrder(order)}
                      disabled={isSaving}
                      className="rounded-xl border-2 border-green-200 bg-green-600 px-4 py-3 text-base font-semibold text-white transition hover:bg-green-700 disabled:opacity-50"
                    >
                      Cobrar
                    </button>
                  )}
                  {nextAction && (
                    <button
                      type="button"
                      onClick={() => updateStatus(order, nextAction.status)}
                      disabled={isSaving}
                      className="btn-primary px-4 py-3 text-base"
                    >
                      {isSaving ? 'Actualizando...' : nextAction.label}
                    </button>
                  )}
                  {order.status !== 'delivered' && (
                    <button
                      type="button"
                      onClick={() => cancelOrder(order)}
                      disabled={isSaving}
                      className="rounded-xl border-2 border-red-200 bg-white px-4 py-3 text-base font-semibold text-red-700 transition hover:border-red-300 disabled:opacity-50"
                    >
                      Cancelar pedido
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {selectedOrderFromList && (
        <OrderDetailModal
          order={selectedOrderFromList}
          onClose={() => setSelectedOrder(null)}
          onCharge={(order) => setChargeOrder(order)}
          onPrint={printTicket}
        />
      )}

      {chargeOrder && (
        <PaymentModal
          order={chargeOrder}
          onClose={() => setChargeOrder(null)}
          onPaid={async () => {
            setChargeOrder(null);
            setMessage({ type: 'success', text: `Pedido #${chargeOrder.order_number} cobrado correctamente.` });
            await loadPendingOrders(false);
          }}
        />
      )}

      <PrintableOrderTicket order={printOrder} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}
