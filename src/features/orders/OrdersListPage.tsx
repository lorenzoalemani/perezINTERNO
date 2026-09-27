import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { OrderStatus, PaymentStatus } from '../../types/database';
import PaymentModal from './PaymentModal';
import {
  type DateFilter,
  formatDateTime,
  formatMoney,
  getDateRange,
  getOrderSearchText,
  OrderDetailModal,
  type OrderStatusFilter,
  type OrderWithItems,
  PaymentBadge,
  type PaymentStatusFilter,
  PrintableOrderTicket,
  StatusBadge,
} from './orderHelpers';

type Message = { type: 'success' | 'error'; text: string };

const PAGE_SIZE = 50;

const statusOptions: { value: OrderStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'preparing', label: 'En preparacion' },
  { value: 'ready', label: 'Listo' },
  { value: 'delivered', label: 'Entregado' },
  { value: 'cancelled', label: 'Cancelado' },
];

const paymentOptions: { value: PaymentStatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendiente' },
  { value: 'paid', label: 'Pagado' },
];

const dateOptions: { value: DateFilter; label: string }[] = [
  { value: 'today', label: 'Hoy' },
  { value: 'yesterday', label: 'Ayer' },
  { value: 'last7', label: 'Ultimos 7 dias' },
  { value: 'all', label: 'Todas' },
];

export default function OrdersListPage() {
  const [orders, setOrders] = useState<OrderWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<Message | null>(null);
  const [statusFilter, setStatusFilter] = useState<OrderStatusFilter>('all');
  const [paymentFilter, setPaymentFilter] = useState<PaymentStatusFilter>('all');
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithItems | null>(null);
  const [chargeOrder, setChargeOrder] = useState<OrderWithItems | null>(null);
  const [printOrder, setPrintOrder] = useState<OrderWithItems | null>(null);
  const isPrintingRef = useRef(false);

  useEffect(() => {
    loadOrders();
  }, [statusFilter, paymentFilter, dateFilter, page]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, paymentFilter, dateFilter]);

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

  async function loadOrders() {
    setLoading(true);
    setMessage(null);

    const range = getDateRange(dateFilter);
    let query = supabase
      .from('orders')
      .select('*, order_items(*, order_item_modifiers(*)), payments(*)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter as OrderStatus);
    }
    if (paymentFilter !== 'all') {
      query = query.eq('payment_status', paymentFilter as PaymentStatus);
    }
    if (range.from) {
      query = query.gte('created_at', range.from);
    }
    if (range.to) {
      query = query.lt('created_at', range.to);
    }

    const { data, error, count } = await query;

    if (error) {
      setMessage({ type: 'error', text: 'No se pudo cargar el historial de pedidos.' });
      setLoading(false);
      return;
    }

    setOrders((data ?? []) as OrderWithItems[]);
    setTotalCount(count ?? 0);
    setLoading(false);
  }

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setSearchTerm(searchInput.trim().toLowerCase());
  }

  const filteredOrders = useMemo(() => {
    if (!searchTerm) return orders;
    return orders.filter((order) => getOrderSearchText(order).includes(searchTerm));
  }, [orders, searchTerm]);

  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pedidos / Historial</h1>
          <p className="text-sm text-gray-500">Consulta pedidos por fecha, estado, pago y cliente.</p>
        </div>
        <button type="button" onClick={loadOrders} className="btn-secondary px-4 py-3 text-base">
          Actualizar
        </button>
      </div>

      {message && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {message.text}
        </div>
      )}

      <section className="card space-y-4">
        <form onSubmit={applySearch} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por numero, nombre o apellido"
            className="w-full rounded-lg border border-gray-300 px-3 py-3"
          />
          <button type="submit" className="btn-primary px-4 py-3 text-base">
            Buscar
          </button>
        </form>

        <div className="grid gap-3 md:grid-cols-3">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Estado</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as OrderStatusFilter)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Pago</span>
            <select
              value={paymentFilter}
              onChange={(event) => setPaymentFilter(event.target.value as PaymentStatusFilter)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
            >
              {paymentOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Fecha</span>
            <select
              value={dateFilter}
              onChange={(event) => setDateFilter(event.target.value as DateFilter)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
            >
              {dateOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {searchTerm && (
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setSearchTerm('');
            }}
            className="text-sm font-semibold text-gray-500"
          >
            Limpiar busqueda
          </button>
        )}
      </section>

      <section className="card overflow-hidden p-0">
        {loading ? (
          <div className="py-12 text-center text-gray-500">Cargando historial...</div>
        ) : filteredOrders.length === 0 ? (
          <div className="py-12 text-center">
            <h2 className="text-xl font-bold text-gray-900">Sin pedidos para mostrar</h2>
            <p className="mt-1 text-gray-500">Ajusta filtros o busca otro cliente.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredOrders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => setSelectedOrder(order)}
                className="grid w-full gap-3 px-4 py-4 text-left transition hover:bg-gray-50 lg:grid-cols-[120px_minmax(0,1fr)_170px_140px_220px]"
              >
                <div>
                  <p className="text-xs font-bold uppercase text-orange-600">Pedido</p>
                  <p className="text-2xl font-black">#{order.order_number}</p>
                </div>
                <div>
                  <p className="font-bold text-gray-900">{order.customer_name}</p>
                  <p className="mt-1 line-clamp-1 text-sm text-gray-500">
                    {order.order_items.map((item) => `${item.quantity}x ${item.product_name_snapshot}`).join(', ')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Fecha</p>
                  <p className="font-semibold">{formatDateTime(order.created_at)}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Total</p>
                  <p className="font-bold">{formatMoney(Number(order.total))}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <StatusBadge status={order.status} />
                  <PaymentBadge status={order.payment_status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500">
          Pagina {page + 1} de {pageCount} - {totalCount} pedido(s)
          {searchTerm ? ' filtrados en esta pagina' : ''}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((current) => Math.max(0, current - 1))}
            className="btn-secondary px-4 py-3 text-base disabled:opacity-50"
          >
            Anterior
          </button>
          <button
            type="button"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((current) => current + 1)}
            className="btn-secondary px-4 py-3 text-base disabled:opacity-50"
          >
            Siguiente
          </button>
        </div>
      </div>

      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
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
            setSelectedOrder(null);
            await loadOrders();
          }}
        />
      )}

      <PrintableOrderTicket order={printOrder} />
    </div>
  );
}
