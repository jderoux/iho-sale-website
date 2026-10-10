"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { deleteProduct, saveProduct } from "@/app/admin/actions";
import { productImageUrl } from "@/lib/format";
import type { AdminProduct, ProductCategoryNode } from "@/lib/types";

type Draft = {
  brand: string;
  model: string;
  sku: string;
  dimensions: string;
  description: string;
  categoryId: string;
  cost: string;
  msrp: string;
  discount: string;
  salePrice: string;
  stock: string;
};

function money(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function ProductForm({ product, categories }: { product?: AdminProduct; categories: ProductCategoryNode[] }) {
  const parents = categories.filter((category) => !category.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  const [draft, setDraft] = useState<Draft>({
    brand: product?.brand ?? "",
    model: product?.model ?? "",
    sku: product?.sku ?? "",
    dimensions: product?.dimensions ?? "",
    description: product?.description ?? "",
    categoryId: product?.categoryId ?? "",
    cost: product ? money(product.cost) : "",
    msrp: product?.msrp == null ? "" : money(product.msrp),
    discount: product?.discountPercent == null ? "" : money(product.discountPercent),
    salePrice: product?.salePrice == null ? "" : money(product.salePrice),
    stock: product ? String(product.stock) : "1",
  });
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const savedImage = product?.imagePath ? productImageUrl(product.imagePath) : null;
  const shownImage = preview ?? (removeImage ? null : savedImage);

  const linked = useMemo(() => draft, [draft]);

  function updateSale(salePrice: string, msrpValue = linked.msrp) {
    const msrp = Number(msrpValue);
    const sale = Number(salePrice);
    const discount = msrp > 0 && sale < msrp ? roundMoney(((msrp - sale) / msrp) * 100) : 0;
    setDraft((current) => ({
      ...current,
      msrp: msrpValue,
      salePrice,
      discount: salePrice === "" ? current.discount : money(discount),
    }));
  }

  function updateDiscount(discount: string, msrpValue = linked.msrp) {
    const msrp = Number(msrpValue);
    const percent = Number(discount);
    const sale = msrp > 0 && discount !== "" ? roundMoney(msrp * (1 - percent / 100)) : Number(linked.salePrice);
    setDraft((current) => ({
      ...current,
      msrp: msrpValue,
      discount,
      salePrice: discount === "" || !Number.isFinite(sale) ? current.salePrice : money(Math.max(0, sale)),
    }));
  }

  return (
    <form
      className="grid gap-8 lg:grid-cols-[1.3fr_0.7fr]"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        setSaved(false);
        try {
          const result = await saveProduct(new FormData(event.currentTarget));
          if (!result.ok) {
            setError(result.message);
            return;
          }
          if (preview) URL.revokeObjectURL(preview);
          setPreview(null);
          setRemoveImage(false);
          if (fileInput.current) fileInput.current.value = "";
          setSaved(true);
          if (!product) router.push(`/admin/productos/${result.id}`);
          router.refresh();
        } finally {
          setPending(false);
        }
      }}
    >
      {product && <input type="hidden" name="id" value={product.id} />}
      <input type="hidden" name="remove_image" value={removeImage && !preview ? "1" : "0"} />
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Marca" name="brand" value={draft.brand} onChange={(brand) => setDraft({ ...draft, brand })} required />
          <TextField label="Modelo" name="model" value={draft.model} onChange={(model) => setDraft({ ...draft, model })} required />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="SKU" name="sku" value={draft.sku} onChange={(sku) => setDraft({ ...draft, sku })} />
          <TextField
            label="Dimensiones"
            name="dimensions"
            value={draft.dimensions}
            onChange={(dimensions) => setDraft({ ...draft, dimensions })}
          />
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Categoría</span>
          <select
            name="category_id"
            value={draft.categoryId}
            required
            onChange={(event) => setDraft({ ...draft, categoryId: event.target.value })}
            className="w-full border border-black/10 px-3 py-2"
          >
            <option value="" disabled>
              Elige una subcategoría
            </option>
            {parents.map((parent) => (
              <optgroup key={parent.id} label={parent.name}>
                {categories
                  .filter((category) => category.parentId === parent.id)
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-gray-500">Descripción</span>
          <textarea
            name="description"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            rows={5}
            className="w-full border border-black/10 px-3 py-2"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Costo" name="cost" value={draft.cost} onChange={(cost) => setDraft({ ...draft, cost })} inputMode="decimal" required />
          <TextField label="Stock" name="stock" value={draft.stock} onChange={(stock) => setDraft({ ...draft, stock })} inputMode="numeric" required />
        </div>
        {product && product.held > 0 && (
          <p className="text-sm text-gray-500">
            Hay {product.held} en reserva. El stock no puede bajar de esa cantidad.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField
            label="MSRP"
            name="msrp"
            value={draft.msrp}
            inputMode="decimal"
            onChange={(msrp) => {
              if (draft.salePrice === "" && draft.discount === "" && msrp !== "" && Number(msrp) >= 0) {
                updateDiscount("50", msrp);
                return;
              }
              updateDiscount(draft.discount, msrp);
            }}
          />
          <TextField
            label="Descuento %"
            name="discount_percent"
            value={draft.discount}
            inputMode="decimal"
            onChange={(discount) => updateDiscount(discount)}
          />
          <TextField
            label="Precio de venta"
            name="sale_price"
            value={draft.salePrice}
            inputMode="decimal"
            onChange={(salePrice) => updateSale(salePrice)}
          />
        </div>
      </div>

      <div className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block text-xs uppercase tracking-wider text-gray-500">
            {savedImage && !removeImage ? "Reemplazar foto" : "Foto"}
          </span>
          <input
            ref={fileInput}
            name="image"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (preview) URL.revokeObjectURL(preview);
              setPreview(file ? URL.createObjectURL(file) : null);
              if (file) setRemoveImage(false);
            }}
            className="w-full text-sm"
          />
        </label>
        <div className="flex h-64 items-center justify-center bg-arquiluz-gray p-4">
          {shownImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shownImage} alt="" className="h-full w-full object-contain" />
          ) : (
            <span className="text-sm text-gray-400">Sin foto</span>
          )}
        </div>
        {shownImage && (
          <button
            type="button"
            className="w-full border border-black/20 px-5 py-2 text-sm text-gray-600 hover:border-arquiluz-accent hover:text-arquiluz-accent"
            onClick={() => {
              if (preview) {
                URL.revokeObjectURL(preview);
                setPreview(null);
                if (fileInput.current) fileInput.current.value = "";
                return;
              }
              setRemoveImage(true);
            }}
          >
            Quitar foto
          </button>
        )}
        {error && <p className="text-sm text-arquiluz-accent">{error}</p>}
        {saved && <p className="text-sm">Guardado.</p>}
        <button type="submit" disabled={pending} className="w-full bg-arquiluz-black px-5 py-3 text-sm font-medium text-white disabled:opacity-40">
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {product && (
          <button
            type="button"
            className="w-full border border-arquiluz-accent px-5 py-3 text-sm font-medium text-arquiluz-accent"
            onClick={() => {
              if (!window.confirm("¿Eliminar esta pieza?")) return;
              const data = new FormData();
              data.set("id", product.id);
              data.set("image_path", product.imagePath ?? "");
              void deleteProduct(data).then((result) => {
                if (!result.ok) {
                  setError(result.message);
                  return;
                }
                router.push("/admin/productos");
                router.refresh();
              });
            }}
          >
            Eliminar
          </button>
        )}
      </div>
    </form>
  );
}

function TextField({
  label,
  name,
  value,
  onChange,
  required,
  inputMode,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  inputMode?: "decimal" | "numeric";
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wider text-gray-500">{label}</span>
      <input
        name={name}
        value={value}
        required={required}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-black/10 px-3 py-2"
      />
    </label>
  );
}
