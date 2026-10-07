import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import type { Category, Modifier, ModifierType, Product } from '../../types/database';

type TabKey = 'products' | 'categories' | 'modifiers';
type ProductWithModifiers = Product & { modifierIds: string[] };

type ProductForm = {
  id: string | null;
  name: string;
  category_id: string;
  price: string;
  simplePrice: string;
  doublePrice: string;
  triplePrice: string;
  description: string;
  active: boolean;
  modifierIds: string[];
};

type CategoryForm = {
  id: string | null;
  name: string;
  active: boolean;
};

type ModifierForm = {
  id: string | null;
  name: string;
  price: string;
  type: ModifierType;
  active: boolean;
};

const emptyProductForm: ProductForm = {
  id: null,
  name: '',
  category_id: '',
  price: '',
  simplePrice: '',
  doublePrice: '',
  triplePrice: '',
  description: '',
  active: true,
  modifierIds: [],
};

const emptyCategoryForm: CategoryForm = { id: null, name: '', active: true };
const emptyModifierForm: ModifierForm = { id: null, name: '', price: '0', type: 'addon', active: true };

const moneyFormatter = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 0,
});

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function normalizePrice(value: string) {
  return Number(value.replace(',', '.'));
}

function normalizeText(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function isBurgerCategory(categoryName: string | undefined) {
  return normalizeText(categoryName ?? '') === 'HAMBURGUESAS';
}

function getVariantPrice(product: Product, key: 'Simple' | 'Doble' | 'Triple') {
  return Number(product.variant_prices?.[key] ?? 0);
}

function formatProductPrice(product: Product, categoryName: string | undefined) {
  if (isBurgerCategory(categoryName)) {
    const simple = getVariantPrice(product, 'Simple') || Number(product.price);
    const doble = getVariantPrice(product, 'Doble');
    const triple = getVariantPrice(product, 'Triple');
    if (simple || doble || triple) {
      return `${formatMoney(simple)} / ${formatMoney(doble || simple)} / ${formatMoney(triple || doble || simple)}`;
    }
  }
  return formatMoney(Number(product.price));
}

export default function ProductsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('products');
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductWithModifiers[]>([]);
  const [modifiers, setModifiers] = useState<Modifier[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showInactive, setShowInactive] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [productForm, setProductForm] = useState<ProductForm | null>(null);
  const [categoryForm, setCategoryForm] = useState<CategoryForm | null>(null);
  const [modifierForm, setModifierForm] = useState<ModifierForm | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadMenuData();
  }, []);

  async function loadMenuData() {
    setLoading(true);
    setMessage(null);

    const [categoriesResult, productsResult, modifiersResult, linksResult] = await Promise.all([
      supabase.from('categories').select('*').order('sort_order').order('name'),
      supabase.from('products').select('*').order('sort_order').order('name'),
      supabase.from('modifiers').select('*').order('name'),
      supabase.from('product_modifiers').select('product_id, modifier_id'),
    ]);

    const error =
      categoriesResult.error ?? productsResult.error ?? modifiersResult.error ?? linksResult.error;

    if (error) {
      setMessage({ type: 'error', text: `No se pudo cargar el menu: ${error.message}` });
      setLoading(false);
      return;
    }

    const modifierIdsByProduct = new Map<string, string[]>();
    for (const link of linksResult.data ?? []) {
      const current = modifierIdsByProduct.get(link.product_id) ?? [];
      current.push(link.modifier_id);
      modifierIdsByProduct.set(link.product_id, current);
    }

    setCategories((categoriesResult.data ?? []) as Category[]);
    setModifiers((modifiersResult.data ?? []) as Modifier[]);
    setProducts(
      ((productsResult.data ?? []) as Product[]).map((product) => ({
        ...product,
        modifierIds: modifierIdsByProduct.get(product.id) ?? [],
      }))
    );
    setLoading(false);
  }

  const categoryNameById = useMemo(
    () => new Map(categories.map((category) => [category.id, category.name])),
    [categories]
  );

  const modifierNameById = useMemo(
    () => new Map(modifiers.map((modifier) => [modifier.id, modifier.name])),
    [modifiers]
  );



  const filteredProducts = products.filter((product) => {
    const matchesCategory = categoryFilter === 'all' || product.category_id === categoryFilter;
    return matchesCategory && (showInactive || product.active);
  });

  function startCreateProduct() {
    setProductForm({
      ...emptyProductForm,
      category_id: categories.find((category) => category.active)?.id ?? categories[0]?.id ?? '',
    });
    setActiveTab('products');
  }

  function startEditProduct(product: ProductWithModifiers) {
    setProductForm({
      id: product.id,
      name: product.name,
      category_id: product.category_id ?? '',
      price: String(product.price),
      simplePrice: String(getVariantPrice(product, 'Simple') || product.price || ''),
      doublePrice: String(getVariantPrice(product, 'Doble') || ''),
      triplePrice: String(getVariantPrice(product, 'Triple') || ''),
      description: product.description ?? '',
      active: product.active,
      modifierIds: product.modifierIds,
    });
    setActiveTab('products');
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (!productForm) return;

    const trimmedName = productForm.name.trim();
    const categoryName = categoryNameById.get(productForm.category_id);
    const isBurger = isBurgerCategory(categoryName);
    const simplePrice = normalizePrice(productForm.simplePrice);
    const doublePrice = normalizePrice(productForm.doublePrice);
    const triplePrice = normalizePrice(productForm.triplePrice);
    const price = isBurger ? simplePrice : normalizePrice(productForm.price);

    if (!trimmedName) {
      setMessage({ type: 'error', text: 'El nombre del producto es obligatorio.' });
      return;
    }
    if (!productForm.category_id) {
      setMessage({ type: 'error', text: 'La categoria es obligatoria.' });
      return;
    }
    if (isBurger && (![simplePrice, doublePrice, triplePrice].every((value) => Number.isFinite(value) && value >= 0))) {
      setMessage({ type: 'error', text: 'Los precios Simple, Doble y Triple deben ser validos.' });
      return;
    }
    if (!isBurger && (!Number.isFinite(price) || price < 0)) {
      setMessage({ type: 'error', text: 'El precio no puede ser negativo.' });
      return;
    }

    setSaving(true);
    setMessage(null);

    const payload = {
      name: trimmedName,
      category_id: productForm.category_id,
      price,
      variant_prices: isBurger
        ? { Simple: simplePrice, Doble: doublePrice, Triple: triplePrice }
        : {},
      active: productForm.active,
    };
    const result = productForm.id
      ? await supabase.from('products').update(payload).eq('id', productForm.id).select().single()
      : await supabase.from('products').insert(payload).select().single();

    if (result.error || !result.data) {
      setMessage({
        type: 'error',
        text: `No se pudo guardar el producto: ${result.error?.message ?? 'Error desconocido'}`,
      });
      setSaving(false);
      return;
    }

    setProductForm(null);
    setMessage({ type: 'success', text: 'Producto guardado correctamente.' });
    await loadMenuData();
    setSaving(false);
  }

  async function toggleProduct(product: ProductWithModifiers) {
    const action = product.active ? 'desactivar' : 'activar';
    if (!window.confirm(`Confirmar ${action} "${product.name}"?`)) return;

    setSaving(true);
    const { error } = await supabase.from('products').update({ active: !product.active }).eq('id', product.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo cambiar el estado: ${error.message}` });
      return;
    }
    setMessage({ type: 'success', text: 'Estado del producto actualizado.' });
    await loadMenuData();
  }

  async function deleteProduct(product: ProductWithModifiers) {
    if (!window.confirm(`¿Eliminar permanentemente "${product.name}"? Esta accion no se puede deshacer.`)) return;

    setSaving(true);
    setMessage(null);

    // First delete modifier links
    const { error: linkError } = await supabase.from('product_modifiers').delete().eq('product_id', product.id);
    if (linkError) {
      setMessage({ type: 'error', text: `No se pudieron eliminar los modificadores asociados: ${linkError.message}` });
      setSaving(false);
      return;
    }

    const { error } = await supabase.from('products').delete().eq('id', product.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo eliminar el producto: ${error.message}. Puede que tenga pedidos asociados; en ese caso, desactivalo.` });
      return;
    }
    setMessage({ type: 'success', text: `Producto "${product.name}" eliminado.` });
    await loadMenuData();
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryForm) return;

    const name = categoryForm.name.trim();
    if (!name) {
      setMessage({ type: 'error', text: 'El nombre de la categoria es obligatorio.' });
      return;
    }

    setSaving(true);
    const result = categoryForm.id
      ? await supabase.from('categories').update({ name, active: categoryForm.active }).eq('id', categoryForm.id)
      : await supabase.from('categories').insert({ name, active: categoryForm.active });
    setSaving(false);
    if (result.error) {
      setMessage({ type: 'error', text: `No se pudo guardar la categoria: ${result.error.message}` });
      return;
    }
    setCategoryForm(null);
    setMessage({ type: 'success', text: 'Categoria guardada correctamente.' });
    await loadMenuData();
  }

  async function toggleCategory(category: Category) {
    const associatedProducts = products.filter((product) => product.category_id === category.id);
    const action = category.active ? 'desactivar' : 'activar';
    const detail =
      associatedProducts.length > 0
        ? ` Tiene ${associatedProducts.length} producto(s) asociado(s), que no seran eliminados.`
        : '';
    if (!window.confirm(`Confirmar ${action} la categoria "${category.name}"?${detail}`)) return;

    setSaving(true);
    const { error } = await supabase.from('categories').update({ active: !category.active }).eq('id', category.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo actualizar la categoria: ${error.message}` });
      return;
    }
    setMessage({ type: 'success', text: 'Estado de categoria actualizado.' });
    await loadMenuData();
  }

  async function deleteCategory(category: Category) {
    const associatedProducts = products.filter((product) => product.category_id === category.id);
    if (associatedProducts.length > 0) {
      setMessage({ type: 'error', text: `No se puede eliminar "${category.name}" porque tiene ${associatedProducts.length} producto(s) asociado(s). Eliminalos o cambiales la categoria primero.` });
      return;
    }
    if (!window.confirm(`¿Eliminar permanentemente la categoria "${category.name}"?`)) return;

    setSaving(true);
    const { error } = await supabase.from('categories').delete().eq('id', category.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo eliminar la categoria: ${error.message}` });
      return;
    }
    setMessage({ type: 'success', text: `Categoria "${category.name}" eliminada.` });
    await loadMenuData();
  }

  async function saveModifier(event: FormEvent) {
    event.preventDefault();
    if (!modifierForm) return;

    const name = modifierForm.name.trim();
    const price = normalizePrice(modifierForm.price);
    if (!name) {
      setMessage({ type: 'error', text: 'El nombre del modificador es obligatorio.' });
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setMessage({ type: 'error', text: 'El precio del modificador no puede ser negativo.' });
      return;
    }

    setSaving(true);
    const payload = { name, price, type: modifierForm.type, active: modifierForm.active };
    const result = modifierForm.id
      ? await supabase.from('modifiers').update(payload).eq('id', modifierForm.id)
      : await supabase.from('modifiers').insert(payload);
    setSaving(false);
    if (result.error) {
      setMessage({ type: 'error', text: `No se pudo guardar el modificador: ${result.error.message}` });
      return;
    }
    setModifierForm(null);
    setMessage({ type: 'success', text: 'Modificador guardado correctamente.' });
    await loadMenuData();
  }

  async function toggleModifier(modifier: Modifier) {
    const action = modifier.active ? 'desactivar' : 'activar';
    if (!window.confirm(`Confirmar ${action} "${modifier.name}"?`)) return;

    setSaving(true);
    const { error } = await supabase.from('modifiers').update({ active: !modifier.active }).eq('id', modifier.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo actualizar el modificador: ${error.message}` });
      return;
    }
    setMessage({ type: 'success', text: 'Estado de modificador actualizado.' });
    await loadMenuData();
  }

  async function deleteModifier(modifier: Modifier) {
    if (!window.confirm(`¿Eliminar permanentemente el modificador "${modifier.name}"?`)) return;

    setSaving(true);
    // Remove links first
    const { error: linkError } = await supabase.from('product_modifiers').delete().eq('modifier_id', modifier.id);
    if (linkError) {
      setMessage({ type: 'error', text: `No se pudieron eliminar las asociaciones: ${linkError.message}` });
      setSaving(false);
      return;
    }
    const { error } = await supabase.from('modifiers').delete().eq('id', modifier.id);
    setSaving(false);
    if (error) {
      setMessage({ type: 'error', text: `No se pudo eliminar el modificador: ${error.message}` });
      return;
    }
    setMessage({ type: 'success', text: `Modificador "${modifier.name}" eliminado.` });
    await loadMenuData();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Productos</h1>
          <p className="text-sm text-gray-500">Administra menu, categorias y adicionales desde Supabase.</p>
        </div>
        <button type="button" onClick={startCreateProduct} className="btn-primary px-4 py-3 text-base">
          Nuevo producto
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

      <div className="card space-y-4">
        <div className="flex flex-wrap gap-2">
          {[
            ['products', 'Productos'],
            ['categories', 'Categorias'],
            ['modifiers', 'Modificadores'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key as TabKey)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                activeTab === key ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-12 text-center text-gray-500">Cargando menu...</div>
        ) : (
          <>
            {activeTab === 'products' && (
              <ProductsTable
                categoryFilter={categoryFilter}
                categoryNameById={categoryNameById}
                categories={categories}
                filteredProducts={filteredProducts}
                modifierNameById={modifierNameById}
                saving={saving}
                setCategoryFilter={setCategoryFilter}
                setShowInactive={setShowInactive}
                showInactive={showInactive}
                startEditProduct={startEditProduct}
                toggleProduct={toggleProduct}
                deleteProduct={deleteProduct}
              />
            )}

            {activeTab === 'categories' && (
              <CategoriesPanel
                categories={categories}
                products={products}
                saving={saving}
                setCategoryForm={setCategoryForm}
                toggleCategory={toggleCategory}
                deleteCategory={deleteCategory}
              />
            )}

            {activeTab === 'modifiers' && (
              <ModifiersPanel
                modifiers={modifiers}
                saving={saving}
                setModifierForm={setModifierForm}
                toggleModifier={toggleModifier}
                deleteModifier={deleteModifier}
              />
            )}
          </>
        )}
      </div>

      {productForm && (
        <ProductEditor
          categoryNameById={categoryNameById}
          categories={categories}
          form={productForm}
          saving={saving}
          setForm={setProductForm}
          onCancel={() => setProductForm(null)}
          onSubmit={saveProduct}
        />
      )}

      {categoryForm && (
        <CategoryEditor
          form={categoryForm}
          saving={saving}
          setForm={setCategoryForm}
          onCancel={() => setCategoryForm(null)}
          onSubmit={saveCategory}
        />
      )}

      {modifierForm && (
        <ModifierEditor
          form={modifierForm}
          saving={saving}
          setForm={setModifierForm}
          onCancel={() => setModifierForm(null)}
          onSubmit={saveModifier}
        />
      )}
    </div>
  );
}

function ProductsTable({
  categories,
  categoryFilter,
  categoryNameById,
  filteredProducts,
  modifierNameById,
  saving,
  setCategoryFilter,
  setShowInactive,
  showInactive,
  startEditProduct,
  toggleProduct,
  deleteProduct,
}: {
  categories: Category[];
  categoryFilter: string;
  categoryNameById: Map<string, string>;
  filteredProducts: ProductWithModifiers[];
  modifierNameById: Map<string, string>;
  saving: boolean;
  setCategoryFilter: (value: string) => void;
  setShowInactive: (value: boolean) => void;
  showInactive: boolean;
  startEditProduct: (product: ProductWithModifiers) => void;
  toggleProduct: (product: ProductWithModifiers) => void;
  deleteProduct: (product: ProductWithModifiers) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="all">Todas las categorias</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Mostrar inactivos
          </label>
        </div>
        <p className="text-sm text-gray-500">{filteredProducts.length} producto(s)</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
            <tr>
              <th className="px-3 py-3">Nombre</th>
              <th className="px-3 py-3">Categoria</th>
              <th className="px-3 py-3">Precio</th>
              <th className="px-3 py-3">Estado</th>
              <th className="px-3 py-3">Modificadores</th>
              <th className="px-3 py-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredProducts.map((product) => (
              <tr key={product.id} className={!product.active ? 'bg-gray-50 text-gray-500' : ''}>
                <td className="px-3 py-3">
                  <div className="font-semibold text-gray-900">{product.name}</div>
                  {product.description && (
                    <div className="max-w-xs truncate text-xs text-gray-500">{product.description}</div>
                  )}
                </td>
                <td className="px-3 py-3">
                  {product.category_id
                    ? categoryNameById.get(product.category_id) ?? 'Sin categoria'
                    : 'Sin categoria'}
                </td>
                <td className="px-3 py-3 font-semibold">
                  {formatProductPrice(
                    product,
                    product.category_id ? categoryNameById.get(product.category_id) : undefined
                  )}
                </td>
                <td className="px-3 py-3">
                  <StatusBadge active={product.active} activeLabel="Activo" inactiveLabel="Inactivo" />
                </td>
                <td className="px-3 py-3">
                  {product.modifierIds.length > 0 ? (
                    <div className="flex max-w-sm flex-wrap gap-1">
                      {product.modifierIds.map((modifierId) => (
                        <span key={modifierId} className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">
                          {modifierNameById.get(modifierId) ?? 'Modificador'}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400">Sin modificadores</span>
                  )}
                </td>
                <td className="px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => startEditProduct(product)}
                      className="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleProduct(product)}
                      disabled={saving}
                      className="rounded-lg border border-gray-300 px-3 py-2 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      {product.active ? 'Desactivar' : 'Activar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteProduct(product)}
                      disabled={saving}
                      className="rounded-lg border border-red-300 px-3 py-2 font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
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
    </section>
  );
}

function CategoriesPanel({
  categories,
  products,
  saving,
  setCategoryForm,
  toggleCategory,
  deleteCategory,
}: {
  categories: Category[];
  products: ProductWithModifiers[];
  saving: boolean;
  setCategoryForm: (form: CategoryForm) => void;
  toggleCategory: (category: Category) => void;
  deleteCategory: (category: Category) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setCategoryForm(emptyCategoryForm)} className="btn-secondary px-4 py-3 text-base">
          Nueva categoria
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {categories.map((category) => (
          <div key={category.id} className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{category.name}</h2>
                <p className="text-sm text-gray-500">
                  {products.filter((product) => product.category_id === category.id).length} producto(s)
                </p>
              </div>
              <StatusBadge active={category.active} activeLabel="Activa" inactiveLabel="Inactiva" />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setCategoryForm({ id: category.id, name: category.name, active: category.active })}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => toggleCategory(category)}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {category.active ? 'Desactivar' : 'Activar'}
              </button>
              <button
                type="button"
                onClick={() => deleteCategory(category)}
                disabled={saving}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ModifiersPanel({
  modifiers,
  saving,
  setModifierForm,
  toggleModifier,
  deleteModifier,
}: {
  modifiers: Modifier[];
  saving: boolean;
  setModifierForm: (form: ModifierForm) => void;
  toggleModifier: (modifier: Modifier) => void;
  deleteModifier: (modifier: Modifier) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setModifierForm(emptyModifierForm)} className="btn-secondary px-4 py-3 text-base">
          Nuevo modificador
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {modifiers.map((modifier) => (
          <div key={modifier.id} className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{modifier.name}</h2>
                <p className="text-sm text-gray-500">
                  {modifier.type === 'addon' ? 'Adicional' : 'Modificacion'} - {formatMoney(modifier.price)}
                </p>
              </div>
              <StatusBadge active={modifier.active} activeLabel="Activo" inactiveLabel="Inactivo" />
            </div>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() =>
                  setModifierForm({
                    id: modifier.id,
                    name: modifier.name,
                    price: String(modifier.price),
                    type: modifier.type,
                    active: modifier.active,
                  })
                }
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => toggleModifier(modifier)}
                disabled={saving}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {modifier.active ? 'Desactivar' : 'Activar'}
              </button>
              <button
                type="button"
                onClick={() => deleteModifier(modifier)}
                disabled={saving}
                className="rounded-lg border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProductEditor({
  categoryNameById,
  categories,
  form,
  saving,
  setForm,
  onCancel,
  onSubmit,
}: {
  categoryNameById: Map<string, string>;
  categories: Category[];
  form: ProductForm;
  saving: boolean;
  setForm: (form: ProductForm) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const isBurger = isBurgerCategory(categoryNameById.get(form.category_id));

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30">
      <form onSubmit={onSubmit} className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">{form.id ? 'Editar producto' : 'Nuevo producto'}</h2>
          <button type="button" onClick={onCancel} className="text-gray-500">
            Cerrar
          </button>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Nombre</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Categoria</span>
            <select
              value={form.category_id}
              onChange={(event) => setForm({ ...form, category_id: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">Seleccionar categoria</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {!category.active ? ' (inactiva)' : ''}
                </option>
              ))}
            </select>
          </label>
          {isBurger ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Simple</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.simplePrice}
                  onChange={(event) => setForm({ ...form, simplePrice: event.target.value, price: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Doble</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.doublePrice}
                  onChange={(event) => setForm({ ...form, doublePrice: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Triple</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.triplePrice}
                  onChange={(event) => setForm({ ...form, triplePrice: event.target.value })}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
                />
              </label>
            </div>
          ) : (
            <label className="block">
              <span className="text-sm font-semibold text-gray-700">Precio</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setForm({ ...form, price: event.target.value })}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </label>
          )}

          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
            />
            Producto activo
          </label>

        </div>

        <div className="mt-6 flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary px-4 py-3 text-base">
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary px-4 py-3 text-base">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function CategoryEditor({
  form,
  saving,
  setForm,
  onCancel,
  onSubmit,
}: {
  form: CategoryForm;
  saving: boolean;
  setForm: (form: CategoryForm) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="mb-4 text-xl font-bold">{form.id ? 'Editar categoria' : 'Nueva categoria'}</h2>
        <label className="block">
          <span className="text-sm font-semibold text-gray-700">Nombre</span>
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            autoFocus
          />
        </label>
        <label className="mt-4 flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(event) => setForm({ ...form, active: event.target.checked })}
          />
          Categoria activa
        </label>
        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary px-4 py-3 text-base">
            Guardar
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary px-4 py-3 text-base">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function ModifierEditor({
  form,
  saving,
  setForm,
  onCancel,
  onSubmit,
}: {
  form: ModifierForm;
  saving: boolean;
  setForm: (form: ModifierForm) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <h2 className="mb-4 text-xl font-bold">{form.id ? 'Editar modificador' : 'Nuevo modificador'}</h2>
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Nombre</span>
            <input
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              autoFocus
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Tipo</span>
            <select
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value as ModifierType })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="addon">Adicional</option>
              <option value="modification">Modificacion</option>
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-semibold text-gray-700">Precio</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(event) => setForm({ ...form, price: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
          </label>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) => setForm({ ...form, active: event.target.checked })}
            />
            Modificador activo
          </label>
        </div>
        <div className="mt-5 flex gap-2">
          <button type="submit" disabled={saving} className="btn-primary px-4 py-3 text-base">
            Guardar
          </button>
          <button type="button" onClick={onCancel} className="btn-secondary px-4 py-3 text-base">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}

function StatusBadge({
  active,
  activeLabel,
  inactiveLabel,
}: {
  active: boolean;
  activeLabel: string;
  inactiveLabel: string;
}) {
  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-semibold ${
        active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
      }`}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}
