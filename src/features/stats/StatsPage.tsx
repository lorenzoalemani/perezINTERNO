import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { statusLabels } from '../orders/orderHelpers';
import {
  formatMoney,
  loadBusinessStats,
  periodOptions,
  type BusinessStats,
  type DailySalesMetric,
  type HourMetric,
  type PeriodKey,
  type ProductMetric,
} from './statsService';

export default function StatsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [period, setPeriod] = useState<PeriodKey>('last7');
  const [stats, setStats] = useState<BusinessStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    loadStats();
  }, [period, isAdmin]);

  async function loadStats() {
    setLoading(true);
    setErrorMessage(null);
    try {
      setStats(await loadBusinessStats(period, { includeCash: isAdmin }));
    } catch {
      setErrorMessage('No se pudieron cargar las estadisticas.');
    } finally {
      setLoading(false);
    }
  }

  const maxDailySales = useMemo(
    () => Math.max(1, ...(stats?.dailySales.map((item) => item.value) ?? [0])),
    [stats]
  );
  const maxHourlyOrders = useMemo(
    () => Math.max(1, ...(stats?.hourlyOrders.map((item) => item.count) ?? [0])),
    [stats]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Estadisticas</h1>
          <p className="text-sm text-gray-500">Ventas, productos, horarios y estado operativo.</p>
        </div>
        <div className="flex gap-2">
          <select
            value={period}
            onChange={(event) => setPeriod(event.target.value as PeriodKey)}
            className="rounded-lg border border-gray-300 bg-white px-3 py-3 font-semibold"
          >
            {periodOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={loadStats} className="btn-secondary px-4 py-3 text-base">
            Actualizar
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {loading || !stats ? (
        <div className="card py-12 text-center text-gray-500">Cargando estadisticas...</div>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Metric label="Ventas" value={formatMoney(stats.salesTotal)} highlight />
            <Metric label="Pedidos validos" value={String(stats.validOrderCount)} />
            <Metric label="Ticket promedio" value={formatMoney(stats.averageTicket)} />
            <Metric label="Cancelaciones" value={`${stats.cancelledCount} (${stats.cancellationPercent.toFixed(1)}%)`} />
          </section>

          <section className={`grid gap-4 ${isAdmin ? 'lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]' : ''}`}>
            {isAdmin && <div className="card space-y-4">
              <h2 className="text-xl font-bold">Ventas por dia</h2>
              <p className="text-sm text-gray-500">Ventas validas: pedidos pagados no cancelados.</p>
              <BarChart
                items={stats.dailySales}
                max={maxDailySales}
                getLabel={(item) => item.label}
                getValue={(item) => item.value}
                formatValue={formatMoney}
              />
            </div>}

            <div className="card space-y-4">
              <h2 className="text-xl font-bold">Metodos de pago</h2>
              <PaymentRow label="Efectivo" amount={stats.cashTotal} percent={stats.cashPercent} />
              <PaymentRow label="Transferencia" amount={stats.transferTotal} percent={stats.transferPercent} />
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <RankingCard
              title="Productos mas vendidos"
              items={stats.topProductsByQuantity}
              emptyText="No hay ventas de productos en este periodo."
              renderValue={(item) => `${item.quantity} unidades`}
            />
            <RankingCard
              title="Productos que mas facturan"
              items={stats.topProductsByRevenue}
              emptyText="No hay facturacion de productos en este periodo."
              renderValue={(item) => formatMoney(item.revenue)}
            />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="card space-y-4">
              <h2 className="text-xl font-bold">Horarios con mas pedidos</h2>
              <p className="text-sm text-gray-500">Basado en created_at: cuando entran los pedidos.</p>
              <BarChart
                items={stats.hourlyOrders}
                max={maxHourlyOrders}
                getLabel={(item) => item.hour}
                getValue={(item) => item.count}
                formatValue={(value) => `${value} pedido(s)`}
              />
            </div>

            <div className="card space-y-4">
              <h2 className="text-xl font-bold">Pedidos por estado</h2>
              <div className="grid gap-2 sm:grid-cols-2">
                {Object.entries(stats.statusCounts).map(([status, count]) => (
                  <div key={status} className="rounded-lg bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-500">
                      {statusLabels[status as keyof typeof statusLabels]}
                    </p>
                    <p className="text-2xl font-black">{count}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {isAdmin && <section className="card space-y-4">
            <h2 className="text-xl font-bold">Caja actual</h2>
            {stats.cashSummary ? (
              <div className="grid gap-3 md:grid-cols-5">
                <Metric label="Efectivo esperado" value={formatMoney(stats.cashSummary.expectedCash)} />
                <Metric label="Ventas efectivo" value={formatMoney(stats.cashSummary.cashSales)} />
                <Metric label="Transferencias" value={formatMoney(stats.cashSummary.transferSales)} />
                <Metric
                  label="Efectivo contado"
                  value={stats.cashSummary.countedCash === null ? '-' : formatMoney(stats.cashSummary.countedCash)}
                />
                <Metric
                  label="Diferencia"
                  value={stats.cashSummary.difference === null ? '-' : formatMoney(stats.cashSummary.difference)}
                />
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-gray-300 p-5 text-sm text-gray-500">
                No hay caja abierta para hoy.
              </p>
            )}
          </section>}
        </>
      )}
    </div>
  );
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-orange-300 bg-orange-50' : 'border-gray-200 bg-white'}`}>
      <p className="text-sm font-semibold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-gray-900">{value}</p>
    </div>
  );
}

function PaymentRow({ label, amount, percent }: { label: string; amount: number; percent: number }) {
  return (
    <div className="rounded-lg bg-gray-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="font-bold">{label}</span>
        <span className="font-black">{formatMoney(amount)}</span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-gray-200">
        <div className="h-full rounded-full bg-orange-600" style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
      <p className="mt-2 text-sm font-semibold text-gray-500">{percent.toFixed(1)}%</p>
    </div>
  );
}

function RankingCard({
  title,
  items,
  emptyText,
  renderValue,
}: {
  title: string;
  items: ProductMetric[];
  emptyText: string;
  renderValue: (item: ProductMetric) => string;
}) {
  return (
    <div className="card space-y-4">
      <h2 className="text-xl font-bold">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={item.name} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 p-3">
              <span className="font-semibold">
                {index + 1}. {item.name}
              </span>
              <span className="font-bold">{renderValue(item)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BarChart<T extends DailySalesMetric | HourMetric>({
  items,
  max,
  getLabel,
  getValue,
  formatValue,
}: {
  items: T[];
  max: number;
  getLabel: (item: T) => string;
  getValue: (item: T) => number;
  formatValue: (value: number) => string;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-500">Sin datos para mostrar.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const value = getValue(item);
        return (
          <div key={getLabel(item)} className="grid grid-cols-[90px_minmax(0,1fr)_120px] items-center gap-3">
            <span className="text-sm font-semibold text-gray-600">{getLabel(item)}</span>
            <div className="h-5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-orange-600" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
            </div>
            <span className="text-right text-sm font-bold">{formatValue(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
