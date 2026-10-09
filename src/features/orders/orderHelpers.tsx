import { createPortal } from 'react-dom';
import type {
  Order,
  OrderItemConfig,
  OrderItem,
  OrderItemModifier,
  OrderStatus,
  Payment,
  PaymentStatus,
} from '../../types/database';

export type OrderItemWithModifiers = OrderItem & {
  order_item_modifiers: OrderItemModifier[];
};

export type OrderWithItems = Order & {
  order_items: OrderItemWithModifiers[];
  payments?: Payment[];
};

export type DateFilter = 'today' | 'yesterday' | 'last7' | 'all';
export type OrderStatusFilter = 'all' | OrderStatus;
export type PaymentStatusFilter = 'all' | PaymentStatus;

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparacion',
  ready: 'Listo',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
};

export const paymentLabels: Record<PaymentStatus, string> = {
  pending: 'Pendiente',
  paid: 'Pagado',
};

export const paymentMethodLabels: Record<Payment['method'], string> = {
  cash: 'Efectivo',
  transfer: 'Transferencia',
};

export const nextStatusByStatus: Partial<Record<OrderStatus, { status: OrderStatus; label: string }>> = {
  pending: { status: 'preparing', label: 'Pasar a preparacion' },
};

export function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

export function formatDateTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleString('es-AR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPickupDate(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatPickupTime(value: string | null) {
  if (!value) return '-';
  return new Date(value).toLocaleTimeString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getDateRange(filter: DateFilter) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  if (filter === 'today') {
    return { from: start.toISOString(), to: null };
  }

  if (filter === 'yesterday') {
    const yesterdayStart = new Date(start);
    yesterdayStart.setDate(yesterdayStart.getDate() - 1);
    return { from: yesterdayStart.toISOString(), to: start.toISOString() };
  }

  if (filter === 'last7') {
    const weekStart = new Date(start);
    weekStart.setDate(weekStart.getDate() - 6);
    return { from: weekStart.toISOString(), to: null };
  }

  return { from: null, to: null };
}

export function getOrderSearchText(order: OrderWithItems) {
  return `${order.order_number} ${order.customer_name}`.toLowerCase();
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const classNameByStatus: Record<OrderStatus, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    preparing: 'bg-blue-100 text-blue-800',
    ready: 'bg-green-100 text-green-800',
    delivered: 'bg-gray-100 text-gray-700',
    cancelled: 'bg-red-100 text-red-700',
  };

  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${classNameByStatus[status]}`}>
      Estado: {statusLabels[status]}
    </span>
  );
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-bold ${
        status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'
      }`}
    >
      Pago: {paymentLabels[status]}
    </span>
  );
}

export function getPrimaryPayment(order: OrderWithItems) {
  return order.payments?.[0] ?? null;
}

export function getOrderItemConfigLines(item: Pick<OrderItem, 'item_config' | 'item_comment'>) {
  const lines: string[] = [];
  const config = item.item_config as OrderItemConfig | null;

  if (config?.kind === 'burger') {
    lines.push(config.protein === 'veggie' ? `Veggie · ${config.meatSize}` : config.meatSize);
    if (config.extraMeats > 0) {
      lines.push(`+ ${config.extraMeats} carne${config.extraMeats === 1 ? '' : 's'} adicional${config.extraMeats === 1 ? '' : 'es'}`);
    }
  }

  if (config?.kind === 'extra') {
    if (config.seasoning) lines.push(config.seasoning);
    if (config.dip) lines.push(`Dip ${config.dip.toLowerCase()}`);
  }

  if (item.item_comment?.trim()) {
    lines.push(`Comentario: ${item.item_comment.trim()}`);
  }

  return lines;
}

export function OrderItemsSummary({ order, compact = false }: { order: OrderWithItems; compact?: boolean }) {
  return (
    <div className="space-y-2">
      {order.order_items.map((item) => (
        <div key={item.id} className={compact ? '' : 'rounded-lg border border-red-100 bg-white p-3'}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">
                {item.quantity}x {item.product_name_snapshot}
              </p>
              {item.order_item_modifiers.length > 0 && (
                <ul className="mt-1 space-y-1 text-sm text-gray-600">
                  {item.order_item_modifiers.map((modifier) => (
                    <li key={modifier.id}>
                      {modifier.name_snapshot}
                      {Number(modifier.price_snapshot) > 0 ? ` +${formatMoney(Number(modifier.price_snapshot))}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {getOrderItemConfigLines(item).length > 0 && (
                <ul className="mt-1 space-y-1 text-sm text-gray-600">
                  {getOrderItemConfigLines(item).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
            {!compact && <p className="font-semibold">{formatMoney(Number(item.subtotal))}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

export function OrderDetailModal({
  order,
  onClose,
  onCharge,
  onPrint,
}: {
  order: OrderWithItems;
  onClose: () => void;
  onCharge?: (order: OrderWithItems) => void;
  onPrint?: (order: OrderWithItems) => void;
}) {
  const payment = getPrimaryPayment(order);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="perez-modal max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="perez-kicker">Pedido</p>
            <h2 className="text-3xl font-black">#{order.order_number}</h2>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-red-100 px-3 py-2 text-sm font-bold hover:border-red-300">
            Cerrar
          </button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <DetailField label="Cliente" value={order.customer_name} />
          <DetailField label="Retiro" value={formatTime(order.pickup_time)} />
          <DetailField label="Creado" value={formatDateTime(order.created_at)} />
          <div className="perez-metric">
            <p className="text-xs font-semibold uppercase text-gray-500">Estados</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <StatusBadge status={order.status} />
              <PaymentBadge status={order.payment_status} />
            </div>
            {payment && (
              <p className="mt-2 text-sm font-semibold text-gray-700">
                Metodo: {paymentMethodLabels[payment.method]}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 border-t border-gray-200 pt-5">
          <OrderItemsSummary order={order} />
        </div>

        <div className="mt-5 flex items-center justify-between rounded-lg border border-red-100 bg-red-50/70 p-4 text-xl font-bold">
          <span>Total</span>
          <span>{formatMoney(Number(order.total))}</span>
        </div>

        <div className="mt-5 rounded-lg border border-red-100 bg-white p-3">
          <p className="text-xs font-semibold uppercase text-gray-500">Notas</p>
          <p className="mt-1 text-gray-800">{order.notes?.trim() || 'Sin notas'}</p>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {onPrint && (
            <button type="button" onClick={() => onPrint(order)} className="btn-secondary">
              Imprimir comanda
            </button>
          )}
          {order.payment_status === 'pending' && onCharge && (
            <button type="button" onClick={() => onCharge(order)} className="btn-primary">
              Cobrar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

type KitchenTicketItem = {
  key: string;
  name: string;
  quantity: number;
  notes: Map<string, number>;
};

function getTicketProductName(item: OrderItemWithModifiers) {
  const configLines = getOrderItemConfigLines({ item_config: item.item_config, item_comment: null });
  return [item.product_name_snapshot, ...configLines].join(' ');
}

function getTicketUnitPrice(item: OrderItemWithModifiers) {
  const quantity = Number(item.quantity);
  return quantity > 0 ? Number(item.subtotal) / quantity : Number(item.unit_price_snapshot);
}

function getKitchenTicketItems(items: OrderItemWithModifiers[]) {
  const grouped = new Map<string, KitchenTicketItem>();

  for (const item of items) {
    const modifierNames = item.order_item_modifiers.map((modifier) => modifier.name_snapshot);
    const name = [getTicketProductName(item), ...modifierNames].join(' ');
    const key = name.toLocaleLowerCase('es-AR');
    const current = grouped.get(key) ?? { key, name, quantity: 0, notes: new Map<string, number>() };
    const quantity = Number(item.quantity);
    current.quantity += quantity;

    const note = item.item_comment?.trim();
    if (note) {
      current.notes.set(note, (current.notes.get(note) ?? 0) + quantity);
    }

    grouped.set(key, current);
  }

  return [...grouped.values()];
}

export function PrintableOrderTicket({ order }: { order: OrderWithItems | null }) {
  if (!order) return null;
  const kitchenItems = getKitchenTicketItems(order.order_items);

  return createPortal(
    <div className="print-ticket">
      <section className="print-ticket-section print-ticket-customer">
        <h1>Pérez&apos;s Burger</h1>
        <p className="print-ticket-order">ORDEN #{order.order_number}</p>
        <hr />
        <p>FECHA: {formatPickupDate(order.pickup_time)}</p>
        <p>RETIRO: {formatPickupTime(order.pickup_time)}</p>
        <p>CLIENTE: {order.customer_name}</p>
        <hr />
        <div className="print-ticket-items">
          {order.order_items.map((item) => (
            <div key={item.id} className="print-ticket-item">
              <p className="print-ticket-product">{getTicketProductName(item)} ({item.quantity}x{formatMoney(getTicketUnitPrice(item))})</p>
              {item.item_comment?.trim() && <p className="print-ticket-detail">(Aclaración: {item.item_comment.trim()})</p>}
            </div>
          ))}
        </div>
        <hr />
        <p className="print-ticket-total">TOTAL: {formatMoney(Number(order.total))}</p>
        <p className="print-ticket-thanks">¡Gracias por elegirnos!</p>
      </section>

      <div className="print-ticket-divider" aria-hidden="true" />

      <section className="print-ticket-section print-ticket-kitchen">
        <h1>COMANDA</h1>
        <hr />
        <p>ORDEN: {order.order_number}</p>
        <p>CLIENTE: {order.customer_name}</p>
        <p>RETIRO: {formatPickupTime(order.pickup_time)}</p>
        <p>FECHA: {formatPickupDate(order.pickup_time)}</p>
        <hr />
        <div className="print-ticket-items">
          {kitchenItems.map((item) => (
            <div key={item.key} className="print-ticket-item">
              <p className="print-ticket-product">{item.quantity} {item.name}</p>
              {[...item.notes.entries()].map(([note, quantity]) => (
                <p key={note} className="print-ticket-detail">(Aclaración: {quantity} {note})</p>
              ))}
            </div>
          ))}
        </div>
        {order.notes?.trim() && (
          <>
            <hr />
            <p className="print-ticket-notes">ACLARACIONES: {order.notes.trim()}</p>
          </>
        )}
      </section>
    </div>,
    document.body
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="perez-metric">
      <p className="text-xs font-semibold uppercase text-gray-500">{label}</p>
      <p className="mt-1 font-semibold text-gray-900">{value}</p>
    </div>
  );
}
