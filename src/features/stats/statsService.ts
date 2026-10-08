import { supabase } from '../../lib/supabase';
import type { CashMovement, CashRegister, OrderStatus, Payment } from '../../types/database';
import type { OrderWithItems } from '../orders/orderHelpers';

export type PeriodKey = 'today' | 'yesterday' | 'last7' | 'last30' | 'month';

export type ProductMetric = {
  name: string;
  quantity: number;
  revenue: number;
};

export type DailySalesMetric = {
  label: string;
  value: number;
};

export type HourMetric = {
  hour: string;
  count: number;
};

export type CashSummaryMetric = {
  isOpen: boolean;
  expectedCash: number;
  countedCash: number | null;
  difference: number | null;
  cashSales: number;
  transferSales: number;
};

export type BusinessStats = {
  period: { key: PeriodKey; label: string; from: string; to: string };
  salesTotal: number;
  validOrderCount: number;
  averageTicket: number;
  activeOrderCount: number;
  cashTotal: number;
  transferTotal: number;
  cashPercent: number;
  transferPercent: number;
  topProductsByQuantity: ProductMetric[];
  topProductsByRevenue: ProductMetric[];
  hourlyOrders: HourMetric[];
  dailySales: DailySalesMetric[];
  statusCounts: Record<OrderStatus, number>;
  cancelledCount: number;
  cancellationPercent: number;
  cashSummary: CashSummaryMetric | null;
};

const periodLabels: Record<PeriodKey, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last7: 'Ultimos 7 dias',
  last30: 'Ultimos 30 dias',
  month: 'Este mes',
};

export function formatMoney(value: number) {
  return value.toLocaleString('es-AR', {
    style: 'currency',
    currency: 'ARS',
    maximumFractionDigits: 0,
  });
}

export function getLocalBusinessDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDayRange(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const from = new Date(year, month - 1, day, 0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function getPeriodRange(key: PeriodKey) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const from = new Date(today);
  const to = new Date(today);
  to.setDate(to.getDate() + 1);

  if (key === 'yesterday') {
    from.setDate(from.getDate() - 1);
    to.setDate(to.getDate() - 1);
  }

  if (key === 'last7') {
    from.setDate(from.getDate() - 6);
  }

  if (key === 'last30') {
    from.setDate(from.getDate() - 29);
  }

  if (key === 'month') {
    from.setDate(1);
  }

  return {
    key,
    label: periodLabels[key],
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

export const periodOptions: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: periodLabels.today },
  { value: 'yesterday', label: periodLabels.yesterday },
  { value: 'last7', label: periodLabels.last7 },
  { value: 'last30', label: periodLabels.last30 },
  { value: 'month', label: periodLabels.month },
];

function emptyStatusCounts(): Record<OrderStatus, number> {
  return {
    pending: 0,
    preparing: 0,
    ready: 0,
    delivered: 0,
    cancelled: 0,
  };
}

function makeDailyBuckets(fromIso: string, toIso: string) {
  const buckets: DailySalesMetric[] = [];
  const cursor = new Date(fromIso);
  const end = new Date(toIso);

  while (cursor < end) {
    buckets.push({
      label: cursor.toLocaleDateString('es-AR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
      value: 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return buckets;
}

function dayIndex(fromIso: string, value: string) {
  const from = new Date(fromIso);
  const date = new Date(value);
  from.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);
  return Math.floor((date.getTime() - from.getTime()) / 86400000);
}

function calculateCashSummary(
  register: CashRegister | null,
  payments: Payment[],
  movements: CashMovement[]
): CashSummaryMetric | null {
  if (!register) return null;

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
    isOpen: !register.closed_at,
    expectedCash,
    countedCash: register.closing_amount === null ? null : Number(register.closing_amount),
    difference:
      register.closing_difference_amount === null ? null : Number(register.closing_difference_amount),
    cashSales,
    transferSales,
  };
}

export async function loadBusinessStats(
  periodKey: PeriodKey,
  options: { includeCash?: boolean } = {}
): Promise<BusinessStats> {
  const includeCash = options.includeCash ?? true;
  const period = getPeriodRange(periodKey);
  const today = getLocalBusinessDate();
  const todayRange = getDayRange(today);

  const [ordersResult, paymentsResult, activeCountResult, registerResult, todayPaymentsResult] =
    await Promise.all([
      supabase
        .from('orders')
        .select('*, order_items(*, order_item_modifiers(*))')
        .gte('created_at', period.from)
        .lt('created_at', period.to)
        .order('created_at', { ascending: true }),
      includeCash
        ? supabase.from('payments').select('*').gte('created_at', period.from).lt('created_at', period.to)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .in('status', ['pending', 'preparing', 'ready']),
      includeCash
        ? supabase.from('cash_registers').select('*').order('opened_at', { ascending: false }).limit(20)
        : Promise.resolve({ data: [], error: null }),
      includeCash
        ? supabase.from('payments').select('*').gte('created_at', todayRange.from).lt('created_at', todayRange.to)
        : Promise.resolve({ data: [], error: null }),
    ]);

  const firstError =
    ordersResult.error ??
    paymentsResult.error ??
    activeCountResult.error ??
    registerResult.error ??
    todayPaymentsResult.error;

  if (firstError) {
    throw firstError;
  }

  const registers = (registerResult.data as CashRegister[] | null) ?? [];
  const openRegister = registers.find((r) => !r.closed_at);
  const register = openRegister ?? null;
  let todayMovements: CashMovement[] = [];
  if (includeCash && register) {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('*')
      .eq('register_id', register.id);
    if (error) throw error;
    todayMovements = (data ?? []) as CashMovement[];
  }

  let orders = (ordersResult.data ?? []) as OrderWithItems[];
  let payments = (paymentsResult.data ?? []) as Payment[];

  // Cuando se consulta el día actual ('today'):
  // Si la caja está cerrada (o no se abrió), todo debe reiniciar a 0.
  // Si está abierta, se toman sólo las operaciones desde que se abrió esa caja.
  if (periodKey === 'today') {
    if (!openRegister) {
      orders = [];
      payments = [];
    } else {
      const openedAtTime = new Date(openRegister.opened_at).getTime();
      orders = orders.filter((order) => new Date(order.created_at).getTime() >= openedAtTime);
      payments = payments.filter((payment) => new Date(payment.created_at).getTime() >= openedAtTime);
    }
  }

  const validOrders = orders.filter((order) => order.status !== 'cancelled' && order.payment_status === 'paid');
  const salesTotal = validOrders.reduce((sum, order) => sum + Number(order.total), 0);
  const validOrderCount = validOrders.length;
  const averageTicket = validOrderCount > 0 ? salesTotal / validOrderCount : 0;
  const cashTotal = payments
    .filter((payment) => payment.method === 'cash')
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const transferTotal = payments
    .filter((payment) => payment.method === 'transfer')
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const paymentTotal = cashTotal + transferTotal;

  const productsByName = new Map<string, ProductMetric>();
  for (const order of validOrders) {
    for (const item of order.order_items) {
      const current = productsByName.get(item.product_name_snapshot) ?? {
        name: item.product_name_snapshot,
        quantity: 0,
        revenue: 0,
      };
      current.quantity += Number(item.quantity);
      current.revenue += Number(item.subtotal);
      productsByName.set(item.product_name_snapshot, current);
    }
  }

  const statusCounts = emptyStatusCounts();
  for (const order of orders) {
    statusCounts[order.status] += 1;
  }

  const dailySales = makeDailyBuckets(period.from, period.to);
  for (const order of validOrders) {
    const index = dayIndex(period.from, order.created_at);
    if (dailySales[index]) {
      dailySales[index].value += Number(order.total);
    }
  }

  const hourlyMap = new Map<string, number>();
  for (const order of orders) {
    const hour = new Date(order.created_at).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
    }).slice(0, 2);
    const label = `${hour}:00`;
    hourlyMap.set(label, (hourlyMap.get(label) ?? 0) + 1);
  }

  const cancelledCount = statusCounts.cancelled;
  const cancellationPercent = orders.length > 0 ? (cancelledCount / orders.length) * 100 : 0;

  return {
    period,
    salesTotal,
    validOrderCount,
    averageTicket,
    activeOrderCount:
      periodKey === 'today'
        ? (!openRegister ? 0 : orders.filter((o) => ['pending', 'preparing', 'ready'].includes(o.status)).length)
        : (activeCountResult.count ?? 0),
    cashTotal,
    transferTotal,
    cashPercent: paymentTotal > 0 ? (cashTotal / paymentTotal) * 100 : 0,
    transferPercent: paymentTotal > 0 ? (transferTotal / paymentTotal) * 100 : 0,
    topProductsByQuantity: [...productsByName.values()]
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 8),
    topProductsByRevenue: [...productsByName.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8),
    hourlyOrders: [...hourlyMap.entries()]
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    dailySales,
    statusCounts,
    cancelledCount,
    cancellationPercent,
    cashSummary:
      includeCash && register
        ? calculateCashSummary(
            register,
            ((todayPaymentsResult.data ?? []) as Payment[]).filter((p) => {
              const pTime = new Date(p.created_at).getTime();
              const regOpen = new Date(register.opened_at).getTime();
              const regClose = register.closed_at ? new Date(register.closed_at).getTime() : Infinity;
              return pTime >= regOpen && pTime <= regClose;
            }),
            todayMovements
          )
        : null,
  };
}
