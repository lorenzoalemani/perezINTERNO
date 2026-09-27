import { useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { PaymentMethod } from '../../types/database';
import { formatMoney, type OrderWithItems } from './orderHelpers';

type PaymentModalProps = {
  order: OrderWithItems;
  onClose: () => void;
  onPaid: () => void;
};

function parseAmount(value: string) {
  return Number(value.replace(/\./g, '').replace(',', '.'));
}

export default function PaymentModal({ order, onClose, onPaid }: PaymentModalProps) {
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [receivedAmount, setReceivedAmount] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const subtotal = Number(order.total);
  const discountPercent = shouldApplyCashDiscount(order) && method === 'cash' ? 10 : 0;
  const discountAmount = Math.round(subtotal * discountPercent) / 100;
  const total = subtotal - discountAmount;
  const received = useMemo(() => parseAmount(receivedAmount), [receivedAmount]);
  const change = Number.isFinite(received) ? received - total : -total;
  const isCashReady = method === 'cash' && Number.isFinite(received) && received >= total;
  const canConfirm = method === 'transfer' || isCashReady;

  async function confirmPayment() {
    if (!canConfirm || saving) return;
    setSaving(true);
    setErrorMessage(null);

    const { error } = await supabase.rpc('close_order_with_payment', {
      p_order_id: order.id,
      p_method: method,
      p_amount: total,
      p_received_amount: method === 'cash' ? received : null,
    });

    setSaving(false);

    if (error) {
      setErrorMessage('No se pudo registrar el cobro. Verifica que el pedido siga pendiente de pago.');
      return;
    }

    const { error: statusError } = await supabase
      .from('orders')
      .update({ status: 'delivered' })
      .eq('id', order.id)
      .neq('status', 'cancelled');

    if (statusError) {
      setErrorMessage('El cobro se registro, pero no se pudo marcar el pedido como entregado.');
      return;
    }

    onPaid();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="perez-modal w-full max-w-md">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="perez-kicker">Cobrar</p>
            <h2 className="text-3xl font-black">Pedido #{order.order_number}</h2>
            <p className="mt-1 text-gray-600">{order.customer_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-red-100 px-3 py-2 text-sm font-bold hover:border-red-300">
            Cerrar
          </button>
        </div>

        <div className="mt-5 rounded-lg border border-red-100 bg-red-50/70 p-4">
          <p className="text-sm font-black text-red-800">Total a cobrar</p>
          <div className="mt-2 space-y-1 text-sm text-gray-700">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span>Descuento {discountPercent > 0 ? '10%' : ''}</span>
              <span>{formatMoney(discountAmount)}</span>
            </div>
          </div>
          <p className="mt-2 text-3xl font-black text-gray-900">{formatMoney(total)}</p>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setMethod('cash')}
            className={`min-h-14 rounded-lg border-2 font-bold ${
              method === 'cash' ? 'border-red-600 bg-red-50 text-red-800' : 'border-gray-200 text-gray-700'
            }`}
          >
            Efectivo
          </button>
          <button
            type="button"
            onClick={() => setMethod('transfer')}
            className={`min-h-14 rounded-lg border-2 font-bold ${
              method === 'transfer' ? 'border-red-600 bg-red-50 text-red-800' : 'border-gray-200 text-gray-700'
            }`}
          >
            Transferencia
          </button>
        </div>

        {method === 'cash' ? (
          <div className="mt-5 space-y-3">
            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Monto recibido</span>
              <input
                value={receivedAmount}
                onChange={(event) => setReceivedAmount(event.target.value)}
                inputMode="decimal"
                autoFocus
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3 text-xl font-bold"
                placeholder="0"
              />
            </label>

            <div className="rounded-lg border border-red-100 bg-white p-4">
              {Number.isFinite(received) && receivedAmount ? (
                change >= 0 ? (
                  <p className="text-xl font-bold text-green-700">Vuelto: {formatMoney(change)}</p>
                ) : (
                  <p className="text-xl font-bold text-red-700">Faltan: {formatMoney(Math.abs(change))}</p>
                )
              ) : (
                <p className="text-sm text-gray-500">Ingresa el monto recibido para calcular el vuelto.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-red-100 bg-white p-4">
            <p className="font-semibold text-gray-900">Confirmas que recibiste la transferencia?</p>
            <p className="mt-1 text-sm text-gray-500">Se registrara el pago por el total del pedido.</p>
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {errorMessage}
          </div>
        )}

        <button
          type="button"
          onClick={confirmPayment}
          disabled={!canConfirm || saving}
          className="btn-primary mt-5 w-full"
        >
          {saving ? 'Registrando...' : 'Confirmar cobro'}
        </button>
      </div>
    </div>
  );
}

function shouldApplyCashDiscount(order: OrderWithItems) {
  const source = order.pickup_time ?? order.created_at;
  const dayName = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    timeZone: 'America/Argentina/Buenos_Aires',
  }).format(new Date(source));
  return dayName === 'Wed' || dayName === 'Thu';
}
