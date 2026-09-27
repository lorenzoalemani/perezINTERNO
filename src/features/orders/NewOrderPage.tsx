import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import type { BurgerProtein, Category, Modifier, NewOrderItemPayload, OrderItemConfig, Product } from '../../types/database';
import { PICKUP_TIME_OPTIONS } from './orderSchedule';
import { getOrderItemConfigLines } from './orderHelpers';

type ProductWithCategory = Product & { category_name: string };
type ProductModifierLink = { product_id: string; modifier_id: string };
type Message = { type: 'success' | 'error'; text: string };

type CartItem = {
  key: string;
  product: ProductWithCategory;
  quantity: number;
  modifiers: Modifier[];
  itemConfig: OrderItemConfig;
  itemComment: string | null;
  capacityUnits: number;
  unitPrice: number;
};

type CustomerForm = {
  firstName: string;
  lastName: string;
  pickupTime: string;
  notes: string;
};

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function toPickupDateTime(time: string) {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);

  // Los horarios operativos pertenecen al local, no a la zona configurada
  // en la computadora que esta usando la caja.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const pickup = new Date(
    Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      hours + 3,
      minutes,
      0,
      0
    )
  );

  if (hours < 6) {
    pickup.setUTCDate(pickup.getUTCDate() + 1);
  }
  return pickup.toISOString();
}

function getLineUnitTotal(item: CartItem) {
  return item.unitPrice + item.modifiers.reduce((sum, modifier) => sum + Number(modifier.price), 0);
}

function getLineSubtotal(item: CartItem) {
  return getLineUnitTotal(item) * item.quantity;
}

function cartKey(productId: string, modifierIds: string[], itemConfig: OrderItemConfig, itemComment: string | null) {
  return `${productId}:${[...modifierIds].sort().join(',')}:${JSON.stringify(itemConfig)}:${itemComment ?? ''}`;
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function isCategory(product: ProductWithCategory, categoryName: string) {
  return normalizeText(product.category_name) === categoryName;
}

function requiresProductConfig(product: ProductWithCategory) {
  const name = normalizeText(product.name);
  return isCategory(product, 'HAMBURGUESAS') || name.includes('PAPAS') || name.includes('BONIATOS');
}

function defaultItemConfig(product: ProductWithCategory): OrderItemConfig {
  if (isCategory(product, 'DIPS')) return { kind: 'dip' };
  if (isCategory(product, 'BEBIDAS')) return { kind: 'beverage' };
  return { kind: 'plain' };
}

function getCapacityUnits(product: ProductWithCategory, config: OrderItemConfig) {
  if (isCategory(product, 'HAMBURGUESAS') && config.kind === 'burger') {
    return config.totalMeats;
  }
  return 0;
}

function formatProductPrice(product: ProductWithCategory) {
  if (isCategory(product, 'HAMBURGUESAS')) {
    const prices = product.variant_prices ?? {};
    const simple = Number(prices.Simple ?? product.price);
    const triple = Number(prices.Triple ?? 0);
    return triple > simple ? `${formatMoney(simple)} a ${formatMoney(triple)}` : formatMoney(simple);
  }
  return Number(product.price) > 0 ? formatMoney(Number(product.price)) : 'Precio pendiente';
}

function getConfiguredUnitPrice(product: ProductWithCategory, itemConfig: OrderItemConfig) {
  if (itemConfig.kind === 'burger') {
    const variantPrice = Number(product.variant_prices?.[itemConfig.meatSize] ?? product.price);
    // El medallón extra se cobra desde la configuración, igual que se registra
    // su cantidad en capacity_units para la producción.
    return variantPrice + itemConfig.extraMeats * 1800;
  }
  return Number(product.price);
}

function productVisual(product: ProductWithCategory) {
  const name = normalizeText(product.name);
  if (isCategory(product, 'HAMBURGUESAS')) return '/menu/burger.svg';
  if (name.includes('PAPA') || name.includes('BONIATO')) return '/menu/fries.svg';
  if (name.includes('NUGGET')) return '/menu/nuggets.svg';
  if (name.includes('ARO')) return '/menu/onion-rings.svg';
  if (name.includes('DIP')) return '/menu/dip.svg';
  if (name.includes('CARNE')) return '/menu/extra-meat.svg';
  return '/menu/drink.svg';
}

function getCartItemConfigLines(item: CartItem) {
  return getOrderItemConfigLines({
    item_config: item.itemConfig,
    item_comment: item.itemComment,
  });
}

export default function NewOrderPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedPickup = searchParams.get('pickup');
  const pickupOptions = PICKUP_TIME_OPTIONS;
  const initialPickup = requestedPickup && pickupOptions.includes(requestedPickup) ? requestedPickup : pickupOptions[0];
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductWithCategory[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [links, setLinks] = useState<ProductModifierLink[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customer, setCustomer] = useState<CustomerForm>({
    firstName: '',
    lastName: '',
    pickupTime: initialPickup ?? '',
    notes: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [modifierProduct, setModifierProduct] = useState<ProductWithCategory | null>(null);
  const [selectedModifierIds, setSelectedModifierIds] = useState<string[]>([]);
  const [configProduct, setConfigProduct] = useState<ProductWithCategory | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    loadOrderData();
  }, []);

  async function loadOrderData() {
    setLoading(true);
    setMessage(null);

    const [categoriesResult, productsResult, modifiersResult, linksResult] = await Promise.all([
      supabase.from('categories').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('products').select('*').eq('active', true).order('sort_order').order('name'),
      supabase.from('modifiers').select('*').eq('active', true).order('name'),
      supabase.from('product_modifiers').select('product_id, modifier_id'),
    ]);

    const error = categoriesResult.error ?? productsResult.error ?? modifiersResult.error ?? linksResult.error;
    if (error) {
      setMessage({
        type: 'error',
        text: 'No se pudo cargar el menu. Revisa la conexion e intenta nuevamente.',
      });
      setLoading(false);
      return;
    }

    const categoryRows = (categoriesResult.data ?? []) as Category[];
    const categoryNameById = new Map(categoryRows.map((category) => [category.id, category.name]));

    setCategories(categoryRows);
    setModifiers((modifiersResult.data ?? []) as Modifier[]);
    setLinks((linksResult.data ?? []) as ProductModifierLink[]);
    setProducts(
      ((productsResult.data ?? []) as Product[])
        .map((product) => ({
          ...product,
          category_name: product.category_id
            ? categoryNameById.get(product.category_id) ?? 'Sin categoria'
            : 'Sin categoria',
        }))
    );
    setLoading(false);
  }

  const modifiersById = useMemo(
    () => new Map(modifiers.map((modifier) => [modifier.id, modifier])),
    [modifiers]
  );

  const modifierIdsByProduct = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const link of links) {
      const current = map.get(link.product_id) ?? [];
      current.push(link.modifier_id);
      map.set(link.product_id, current);
    }
    return map;
  }, [links]);

  const filteredProducts = products.filter(
    (product) => selectedCategory === 'all' || product.category_id === selectedCategory
  );

  const subtotal = cart.reduce((sum, item) => sum + getLineSubtotal(item), 0);
  const total = subtotal;
  const itemCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  function addProduct(product: ProductWithCategory) {
    setMessage(null);
    if (requiresProductConfig(product)) {
      setConfigProduct(product);
      return;
    }

    const availableModifierIds = modifierIdsByProduct.get(product.id) ?? [];
    const availableModifiers = availableModifierIds
      .map((id) => modifiersById.get(id))
      .filter((modifier): modifier is Modifier => Boolean(modifier));

    if (availableModifiers.length > 0) {
      setModifierProduct(product);
      setSelectedModifierIds([]);
      return;
    }

    addConfiguredProduct(product, [], defaultItemConfig(product), null, getCapacityUnits(product, defaultItemConfig(product)));
  }

  function addConfiguredProduct(
    product: ProductWithCategory,
    selectedIds: string[],
    itemConfig: OrderItemConfig,
    itemComment: string | null,
    capacityUnits: number
  ) {
    const selectedModifiers = selectedIds
      .map((id) => modifiersById.get(id))
      .filter((modifier): modifier is Modifier => Boolean(modifier));
    const key = cartKey(product.id, selectedModifiers.map((modifier) => modifier.id), itemConfig, itemComment);

    setCart((currentCart) => {
      const existing = currentCart.find((item) => item.key === key);
      if (existing) {
        return currentCart.map((item) =>
          item.key === key ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...currentCart, {
        key,
        product,
        quantity: 1,
        modifiers: selectedModifiers,
        itemConfig,
        itemComment,
        capacityUnits,
        unitPrice: getConfiguredUnitPrice(product, itemConfig),
      }];
    });
    setModifierProduct(null);
    setConfigProduct(null);
    setSelectedModifierIds([]);
  }

  function changeQuantity(key: string, delta: number) {
    setCart((currentCart) =>
      currentCart
        .map((item) => (item.key === key ? { ...item, quantity: item.quantity + delta } : item))
        .filter((item) => item.quantity > 0)
    );
  }

  function removeItem(key: string) {
    setCart((currentCart) => currentCart.filter((item) => item.key !== key));
  }

  function validateOrder() {
    if (cart.length === 0) {
      setMessage({ type: 'error', text: 'Agrega al menos un producto al pedido.' });
      return false;
    }
    if (!customer.firstName.trim() || !customer.lastName.trim()) {
      setMessage({ type: 'error', text: 'Completa nombre y apellido del cliente.' });
      return false;
    }
    if (!customer.pickupTime) {
      setMessage({ type: 'error', text: 'Selecciona un horario de retiro.' });
      return false;
    }
    return true;
  }

  function openReview(event: FormEvent) {
    event.preventDefault();
    setMessage(null);
    if (!validateOrder()) return;
    setReviewOpen(true);
  }

  async function confirmOrder() {
    if (!validateOrder()) return;

    setSaving(true);
    setMessage(null);

    const payload: NewOrderItemPayload[] = cart.map((item) => ({
      product_id: item.product.id,
      product_name: item.product.name,
      unit_price: item.unitPrice,
      quantity: item.quantity,
      item_comment: item.itemComment,
      item_config: item.itemConfig,
      capacity_units: item.capacityUnits,
      modifiers: item.modifiers.map((modifier) => ({
        modifier_id: modifier.id,
        name: modifier.name,
        price: Number(modifier.price),
        type: modifier.type,
      })),
    }));

    const { data, error } = await supabase.rpc('create_order', {
      p_customer_name: `${customer.firstName.trim()} ${customer.lastName.trim()}`,
      p_pickup_time: toPickupDateTime(customer.pickupTime),
      p_notes: customer.notes.trim() || null,
      p_items: payload,
    });

    setSaving(false);

    if (error || !data) {
      setMessage({
        type: 'error',
        text: 'No se pudo guardar el pedido. Verifica la sesion e intenta nuevamente.',
      });
      return;
    }

    const order = data as { order_number: number };
    navigate('/', {
      state: {
        message: `Pedido #${order.order_number} creado correctamente.`,
      },
    });
  }

  const modifierGroups = useMemo(() => {
    if (!modifierProduct) return { addon: [], modification: [] };
    const ids = modifierIdsByProduct.get(modifierProduct.id) ?? [];
    const available = ids
      .map((id) => modifiersById.get(id))
      .filter((modifier): modifier is Modifier => Boolean(modifier));
    return {
      addon: available.filter((modifier) => modifier.type === 'addon'),
      modification: available.filter((modifier) => modifier.type === 'modification'),
    };
  }, [modifierProduct, modifierIdsByProduct, modifiersById]);

  return (
    <div className="new-order-screen">
      <div className="new-order-header">
        <div>
          <p className="new-order-eyebrow">Pedidos</p>
          <h1>Nueva comanda</h1>
          <p>Seleccioná el menú y completá los datos de retiro.</p>
        </div>
        <div className="new-order-summary">
          <span>{itemCount} {itemCount === 1 ? 'ítem' : 'ítems'}</span>
          <strong>{formatMoney(total)}</strong>
        </div>
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
        <div className="card py-12 text-center text-gray-500">Cargando menu...</div>
      ) : (
        <div className="new-order-layout">
          <section className="new-order-menu">
            <div className="new-order-section-heading">
              <h2>Menú</h2>
              <span>Elegí una categoría</span>
            </div>
            <div className="new-order-filters">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`new-order-filter ${
                  selectedCategory === 'all'
                    ? 'bg-red-700 text-white'
                    : 'bg-white text-gray-700 border border-red-100 hover:border-red-300'
                }`}
              >
                Todos
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedCategory(category.id)}
                  className={`new-order-filter ${
                    selectedCategory === category.id
                      ? 'bg-red-700 text-white'
                      : 'bg-white text-gray-700 border border-red-100 hover:border-red-300'
                  }`}
                >
                  {category.name}
                </button>
              ))}
            </div>

            <div className="new-order-products">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  className="new-order-product"
                >
                  <span className="flex items-start gap-3">
                    <img
                      src={product.image_url || productVisual(product)}
                      alt={product.name}
                      className="new-order-product-image"
                    />
                    <span className="min-w-0">
                      <span className="new-order-product-category">{product.category_name}</span>
                      <span className="new-order-product-name">{product.name}</span>
                      <span className="new-order-product-price">{formatProductPrice(product)}</span>
                    </span>
                  </span>
                  <span className="new-order-add">Agregar <b>+</b></span>
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 && (
              <div className="new-order-empty">No hay productos activos en esta categoría.</div>
            )}
          </section>

          <aside>
            <form onSubmit={openReview} className="new-order-cart">
              <div className="new-order-cart-header">
                <div>
                  <p className="new-order-eyebrow">Resumen</p>
                  <h2>Pedido actual</h2>
                </div>
                {cart.length > 0 && (
                  <button type="button" onClick={() => setCart([])} className="text-sm font-bold text-gray-500 hover:text-red-700">
                    Vaciar
                  </button>
                )}
              </div>

              <div className="max-h-[38rem] space-y-3 overflow-y-auto pr-1">
                {cart.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
                    Agrega productos para empezar la comanda.
                  </div>
                ) : (
                  cart.map((item) => (
                    <div key={item.key} className="new-order-cart-item">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="new-order-cart-name">{item.product.name}</p>
                          <p className="new-order-cart-price">
                            {item.unitPrice > 0 ? `${formatMoney(item.unitPrice)} unidad` : 'Precio pendiente'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeItem(item.key)}
                          className="new-order-remove"
                        >
                          Eliminar
                        </button>
                      </div>

                      {item.modifiers.length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          {item.modifiers.map((modifier) => (
                            <li key={modifier.id}>
                              {modifier.name} {Number(modifier.price) > 0 ? `+${formatMoney(Number(modifier.price))}` : ''}
                            </li>
                          ))}
                        </ul>
                      )}
                      {getCartItemConfigLines(item).length > 0 && (
                        <ul className="mt-2 space-y-1 text-sm text-gray-600">
                          {getCartItemConfigLines(item).map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}

                      <div className="new-order-cart-footer">
                        <div className="new-order-quantity">
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.key, -1)}
                            className="new-order-quantity-button"
                          >
                            -
                          </button>
                          <span>{item.quantity}</span>
                          <button
                            type="button"
                            onClick={() => changeQuantity(item.key, 1)}
                            className="new-order-quantity-button"
                          >
                            +
                          </button>
                        </div>
                        <div className="new-order-line-total">
                          <p>Subtotal</p>
                          <strong>{formatMoney(getLineSubtotal(item))}</strong>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="new-order-fields">
                <label>
                  <span>Nombre</span>
                  <input
                    value={customer.firstName}
                    onChange={(event) => setCustomer({ ...customer, firstName: event.target.value })}
                    className="new-order-input"
                    autoComplete="off"
                  />
                </label>
                <label>
                  <span>Apellido</span>
                  <input
                    value={customer.lastName}
                    onChange={(event) => setCustomer({ ...customer, lastName: event.target.value })}
                    className="new-order-input"
                    autoComplete="off"
                  />
                </label>
              </div>

              <label className="new-order-field">
                <span>Horario de retiro</span>
                <select
                  value={customer.pickupTime}
                  onChange={(event) => setCustomer({ ...customer, pickupTime: event.target.value })}
                  className="new-order-input"
                >
                  {pickupOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </label>

              <label className="new-order-field">
                <span>Notas del pedido</span>
                <textarea
                  value={customer.notes}
                  onChange={(event) => setCustomer({ ...customer, notes: event.target.value })}
                  className="new-order-input min-h-20"
                  placeholder="Opcional"
                />
              </label>

              <div className="new-order-total">
                <div>
                  <span>Subtotal</span>
                  <span>{formatMoney(subtotal)}</span>
                </div>
                <div>
                  <span>Total</span>
                  <span>{formatMoney(total)}</span>
                </div>
              </div>

              <button type="submit" disabled={saving} className="new-order-submit">
                Revisar pedido
              </button>
            </form>
          </aside>
        </div>
      )}

      {modifierProduct && (
        <ModifierModal
          product={modifierProduct}
          addonModifiers={modifierGroups.addon}
          modificationModifiers={modifierGroups.modification}
          selectedModifierIds={selectedModifierIds}
          setSelectedModifierIds={setSelectedModifierIds}
          onCancel={() => setModifierProduct(null)}
          onConfirm={() =>
            addConfiguredProduct(
              modifierProduct,
              selectedModifierIds,
              defaultItemConfig(modifierProduct),
              null,
              getCapacityUnits(modifierProduct, defaultItemConfig(modifierProduct))
            )
          }
        />
      )}

      {configProduct && (
        <ProductConfigModal
          product={configProduct}
          onCancel={() => setConfigProduct(null)}
          onConfirm={(itemConfig, itemComment, capacityUnits) =>
            addConfiguredProduct(configProduct, [], itemConfig, itemComment, capacityUnits)
          }
        />
      )}

      {reviewOpen && (
        <ReviewModal
          cart={cart}
          customer={customer}
          total={total}
          saving={saving}
          onCancel={() => setReviewOpen(false)}
          onConfirm={confirmOrder}
        />
      )}
    </div>
  );
}

function ProductConfigModal({
  product,
  onCancel,
  onConfirm,
}: {
  product: ProductWithCategory;
  onCancel: () => void;
  onConfirm: (itemConfig: OrderItemConfig, itemComment: string | null, capacityUnits: number) => void;
}) {
  const [meatSize, setMeatSize] = useState<'Simple' | 'Doble' | 'Triple'>('Simple');
  const [protein, setProtein] = useState<BurgerProtein>('carne');
  const [extraMeats, setExtraMeats] = useState(0);
  const [comment, setComment] = useState('');
  const [seasoning, setSeasoning] = useState<'Sin sazon' | 'Sazonadas' | 'Sazonados'>('Sin sazon');
  const [dip, setDip] = useState<'Cheddar' | 'Alioli' | 'Barbacoa' | ''>('');

  const isBurger = isCategory(product, 'HAMBURGUESAS');
  const isExtra = isCategory(product, 'EXTRAS');
  const productName = normalizeText(product.name);
  const needsSeasoning = productName.includes('PAPAS') || productName.includes('BONIATOS');
  const baseMeatsBySize = { Simple: 1, Doble: 2, Triple: 3 };
  const totalMeats = isBurger && protein === 'carne' ? baseMeatsBySize[meatSize] + extraMeats : 0;

  function confirm() {
    if (isBurger) {
      const itemConfig: OrderItemConfig = {
        kind: 'burger',
        meatSize,
        baseMeats: baseMeatsBySize[meatSize],
        extraMeats,
        totalMeats,
        protein,
      };
      onConfirm(itemConfig, comment.trim() || null, totalMeats);
      return;
    }

    if (isExtra) {
      const itemConfig: OrderItemConfig = {
        kind: 'extra',
        ...(needsSeasoning ? { seasoning } : {}),
        dip: dip || null,
      };
      onConfirm(itemConfig, null, 0);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="perez-modal w-full max-w-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{product.name}</h2>
            <p className="text-sm text-gray-500">Configura el producto para la comanda.</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg border border-red-100 px-3 py-2 text-sm font-bold hover:border-red-300">
            Cerrar
          </button>
        </div>

        {isBurger && (
          <div className="space-y-4">
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">Medallón</h3>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'carne', label: 'Carne' },
                  { value: 'veggie', label: 'Veggie' },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setProtein(option.value);
                      if (option.value === 'veggie') setExtraMeats(0);
                    }}
                    className={`rounded-lg border-2 px-3 py-3 font-bold ${
                      protein === option.value ? 'border-red-600 bg-red-50 text-red-800' : 'border-red-100 text-gray-700'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">Cantidad de carnes</h3>
              <div className="grid grid-cols-3 gap-2">
                {(['Simple', 'Doble', 'Triple'] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setMeatSize(option)}
                    className={`rounded-lg border-2 px-3 py-3 font-bold ${
                      meatSize === option ? 'border-red-600 bg-red-50 text-red-800' : 'border-red-100 text-gray-700'
                    }`}
                  >
                    <span className="block">{option}</span>
                    <span className="mt-1 block text-xs font-semibold opacity-75">
                      {formatMoney(Number(product.variant_prices?.[option] ?? product.price))}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            {protein === 'carne' && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">Carnes adicionales</h3>
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setExtraMeats(option)}
                    className={`rounded-lg border-2 px-3 py-3 font-bold ${
                      extraMeats === option ? 'border-red-600 bg-red-50 text-red-800' : 'border-red-100 text-gray-700'
                    }`}
                  >
                    {option === 0 ? 'Sin extra' : `+${option} carne${option === 1 ? '' : 's'}`}
                  </button>
                ))}
              </div>
                  <p className="mt-2 text-sm font-semibold text-gray-700">
                    Total: {totalMeats} medallón(es) · {formatMoney(getConfiguredUnitPrice(product, {
                      kind: 'burger', meatSize, baseMeats: baseMeatsBySize[meatSize], extraMeats, totalMeats,
                    }))}
                  </p>
            </section>
            )}

            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Comentario</span>
              <input
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-3"
                placeholder="sin cebolla, bien cocida, poca salsa..."
              />
            </label>
          </div>
        )}

        {isExtra && (
          <div className="space-y-4">
            {needsSeasoning && (
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">Sazon</h3>
                <div className="grid grid-cols-2 gap-2">
                  {(['Sin sazon', productName === 'PAPAS' ? 'Sazonadas' : 'Sazonados'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setSeasoning(option)}
                      className={`rounded-lg border-2 px-3 py-3 font-bold ${
                        seasoning === option ? 'border-red-600 bg-red-50 text-red-800' : 'border-red-100 text-gray-700'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">Dip opcional</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(['', 'Cheddar', 'Alioli', 'Barbacoa'] as const).map((option) => (
                  <button
                    key={option || 'none'}
                    type="button"
                    onClick={() => setDip(option)}
                    className={`rounded-lg border-2 px-3 py-3 font-bold ${
                      dip === option ? 'border-red-600 bg-red-50 text-red-800' : 'border-red-100 text-gray-700'
                    }`}
                  >
                    {option || 'Sin dip'}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={confirm} className="btn-primary">
            Agregar al pedido
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModifierModal({
  product,
  addonModifiers,
  modificationModifiers,
  selectedModifierIds,
  setSelectedModifierIds,
  onCancel,
  onConfirm,
}: {
  product: ProductWithCategory;
  addonModifiers: Modifier[];
  modificationModifiers: Modifier[];
  selectedModifierIds: string[];
  setSelectedModifierIds: (ids: string[]) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  function toggleModifier(id: string, checked: boolean) {
    setSelectedModifierIds(
      checked ? [...selectedModifierIds, id] : selectedModifierIds.filter((modifierId) => modifierId !== id)
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="perez-modal w-full max-w-xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{product.name}</h2>
            <p className="text-sm text-gray-500">Selecciona modificadores</p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg border border-red-100 px-3 py-2 text-sm font-bold hover:border-red-300">
            Cerrar
          </button>
        </div>

        <ModifierGroup title="Adicionales" modifiers={addonModifiers} selectedIds={selectedModifierIds} onToggle={toggleModifier} />
        <ModifierGroup title="Cambios" modifiers={modificationModifiers} selectedIds={selectedModifierIds} onToggle={toggleModifier} />

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onConfirm} className="btn-primary">
            Agregar al pedido
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}

function ModifierGroup({
  title,
  modifiers,
  selectedIds,
  onToggle,
}: {
  title: string;
  modifiers: Modifier[];
  selectedIds: string[];
  onToggle: (id: string, checked: boolean) => void;
}) {
  if (modifiers.length === 0) return null;

  return (
    <section className="mb-4">
      <h3 className="mb-2 text-xs font-bold uppercase text-gray-500">{title}</h3>
      <div className="grid gap-2 sm:grid-cols-2">
        {modifiers.map((modifier) => (
          <label key={modifier.id} className="flex items-center gap-3 rounded-lg border border-gray-200 p-3">
            <input
              type="checkbox"
              checked={selectedIds.includes(modifier.id)}
              onChange={(event) => onToggle(modifier.id, event.target.checked)}
              className="h-5 w-5"
            />
            <span className="min-w-0">
              <span className="block font-semibold">{modifier.name}</span>
              <span className="text-sm text-gray-500">{formatMoney(Number(modifier.price))}</span>
            </span>
          </label>
        ))}
      </div>
    </section>
  );
}

function ReviewModal({
  cart,
  customer,
  total,
  saving,
  onCancel,
  onConfirm,
}: {
  cart: CartItem[];
  customer: CustomerForm;
  total: number;
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div className="perez-modal max-h-[90vh] w-full max-w-2xl overflow-y-auto">
        <h2 className="text-xl font-bold">Revisar pedido</h2>
        <p className="mt-1 text-sm text-gray-500">
          {customer.firstName} {customer.lastName} - Retiro: {customer.pickupTime}
        </p>

        <OrderSummary cart={cart} className="mt-4" />

        {customer.notes.trim() && (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
            <span className="font-semibold">Notas: </span>
            {customer.notes.trim()}
          </div>
        )}

        <div className="mt-4 flex items-center justify-between rounded-lg border border-red-100 bg-red-50/70 p-4 text-xl font-bold">
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onConfirm} disabled={saving} className="btn-primary">
            {saving ? 'Guardando...' : 'Confirmar pedido'}
          </button>
          <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary">
            Seguir editando
          </button>
        </div>
      </div>
    </div>
  );
}

function OrderSummary({ cart, className = '', compact = false }: { cart: CartItem[]; className?: string; compact?: boolean }) {
  return (
    <div className={`space-y-3 ${className}`}>
      {cart.map((item) => (
        <div key={item.key} className={compact ? '' : 'rounded-lg border border-gray-200 p-3'}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-bold">
                {item.quantity}x {item.product.name}
              </p>
              {item.modifiers.length > 0 && (
                <ul className="mt-1 space-y-1 text-sm text-gray-600">
                  {item.modifiers.map((modifier) => (
                    <li key={modifier.id}>
                      {modifier.name} {Number(modifier.price) > 0 ? `+${formatMoney(Number(modifier.price))}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              {getCartItemConfigLines(item).length > 0 && (
                <ul className="mt-1 space-y-1 text-sm text-gray-600">
                  {getCartItemConfigLines(item).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
            <p className="font-semibold">{formatMoney(getLineSubtotal(item))}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
