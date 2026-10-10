"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { readInquiryEmail } from "@/lib/inquiry-email";
import { getInquiry } from "@/lib/admin";
import { sendQuotePdf } from "@/lib/quote-email";
import { buildQuotePdf } from "@/lib/quote-pdf";
import { getQuote } from "@/lib/quotes";
import { toNumber } from "@/lib/format";

type ItemPayload = {
  id?: string;
  productId?: string | null;
  quantity: number;
};

type SavedLine = {
  id: string;
  product_id: string | null;
  brand: string;
  model: string;
  sku: string | null;
  msrp: number | string;
  sale_price: number | string;
};

function parseMoney(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function parseItems(value: FormDataEntryValue | null) {
  try {
    const parsed = JSON.parse(String(value ?? "[]")) as ItemPayload[];
    const merged = new Map<string, ItemPayload>();
    for (const item of parsed) {
      const quantity = Math.floor(Number(item.quantity));
      if (!Number.isInteger(quantity) || quantity < 1) return null;
      const key = item.id || item.productId || "";
      if (!key) return null;
      const current = merged.get(key);
      merged.set(key, {
        id: item.id,
        productId: item.productId,
        quantity: (current?.quantity ?? 0) + quantity,
      });
    }
    return [...merged.values()];
  } catch {
    return null;
  }
}

export async function saveQuote(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const company = String(formData.get("company") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const phone = String(formData.get("phone") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const shipping = parseMoney(formData.get("shipping"));
  const items = parseItems(formData.get("items"));

  if (!name) return { ok: false as const, message: "El nombre es obligatorio." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, message: "Escribe un correo válido." };
  if (shipping === null) return { ok: false as const, message: "Revisa el monto de envío." };
  if (!items) return { ok: false as const, message: "Revisa las cantidades." };

  const header = {
    name,
    company: company || null,
    email,
    phone,
    note: note || null,
    shipping,
  };

  let quoteId = id;
  if (quoteId) {
    const { data: current, error: currentError } = await supabase.from("quotes").select("status").eq("id", quoteId).maybeSingle();
    if (currentError) return { ok: false as const, message: currentError.message };
    if (!current) return { ok: false as const, message: "No encontramos la cotización." };
    if (current.status === "despachada") return { ok: false as const, message: "Esta cotización ya fue despachada." };
    const { error } = await supabase.from("quotes").update(header).eq("id", quoteId);
    if (error) return { ok: false as const, message: error.message };
  } else {
    const { data, error } = await supabase.from("quotes").insert(header).select("id").single();
    if (error || !data) return { ok: false as const, message: error?.message ?? "No se pudo crear la cotización." };
    quoteId = data.id;
  }

  const saved = await replaceItems(supabase, quoteId, items);
  if (!saved.ok) return saved;

  revalidatePath("/admin/cotizaciones");
  revalidatePath(`/admin/cotizaciones/${quoteId}`);
  return { ok: true as const, id: quoteId };
}

async function replaceItems(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  quoteId: string,
  items: ItemPayload[]
) {
  const { data: existing, error: existingError } = await supabase
    .from("quote_items")
    .select("id, product_id, brand, model, sku, msrp, sale_price")
    .eq("quote_id", quoteId);
  if (existingError) return { ok: false as const, message: existingError.message };

  const previous = (existing ?? []) as SavedLine[];
  const previousById = new Map(previous.map((row) => [row.id, row]));
  const previousByProduct = new Map(previous.filter((row) => row.product_id).map((row) => [row.product_id as string, row]));
  const neededIds = items
    .map((item) => item.productId)
    .filter((productId): productId is string => Boolean(productId && !previousByProduct.has(productId)));
  const productsById = new Map<string, { id: string; brand: string; model: string; sku: string | null; msrp: number; sale_price: number }>();
  if (neededIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, brand, model, sku, msrp, sale_price")
      .in("id", neededIds);
    if (productsError) return { ok: false as const, message: productsError.message };
    for (const product of products ?? []) productsById.set(product.id, product);
  }

  const kept = new Set<string>();
  for (const item of items) {
    const prior = (item.id && previousById.get(item.id)) || (item.productId ? previousByProduct.get(item.productId) : undefined);
    if (prior) {
      kept.add(prior.id);
      const { error } = await supabase.from("quote_items").update({ quantity: item.quantity }).eq("id", prior.id);
      if (error) return { ok: false as const, message: error.message };
      continue;
    }
    const product = item.productId ? productsById.get(item.productId) : undefined;
    if (!product) return { ok: false as const, message: "Una pieza ya no está en el catálogo." };
    const { data, error } = await supabase
      .from("quote_items")
      .insert({
        quote_id: quoteId,
        product_id: product.id,
        brand: product.brand,
        model: product.model,
        sku: product.sku,
        quantity: item.quantity,
        msrp: toNumber(product.msrp),
        sale_price: toNumber(product.sale_price),
      })
      .select("id")
      .single();
    if (error || !data) return { ok: false as const, message: error?.message ?? "No se pudo agregar la pieza." };
    kept.add(data.id);
  }

  const remove = previous.filter((row) => !kept.has(row.id)).map((row) => row.id);
  if (remove.length > 0) {
    const { error } = await supabase.from("quote_items").delete().in("id", remove);
    if (error) return { ok: false as const, message: error.message };
  }
  return { ok: true as const };
}

export async function createQuoteFromInquiry(inquiryId: string) {
  const { supabase } = await requireAdmin();
  const { data: existing, error: existingError } = await supabase.from("quotes").select("id").eq("inquiry_id", inquiryId).maybeSingle();
  if (existingError) return { ok: false as const, message: existingError.message };
  if (existing) return { ok: true as const, id: existing.id };

  const inquiry = await getInquiry(inquiryId);
  if (!inquiry) return { ok: false as const, message: "No encontramos esa solicitud." };

  const productIds = inquiry.items.map((item) => item.productId).filter((id): id is string => Boolean(id));
  const productsById = new Map<string, { id: string; brand: string; model: string; sku: string | null; msrp: number | string; sale_price: number | string }>();
  if (productIds.length > 0) {
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, brand, model, sku, msrp, sale_price")
      .in("id", productIds);
    if (productsError) return { ok: false as const, message: productsError.message };
    for (const product of products ?? []) productsById.set(product.id, product);
  }

  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({
      inquiry_id: inquiryId,
      name: inquiry.name,
      company: inquiry.company,
      email: inquiry.email,
      phone: inquiry.phone,
      note: inquiry.note,
    })
    .select("id")
    .single();
  if (error?.code === "23505") {
    const { data: again } = await supabase.from("quotes").select("id").eq("inquiry_id", inquiryId).maybeSingle();
    if (again) return { ok: true as const, id: again.id };
  }
  if (error || !quote) return { ok: false as const, message: error?.message ?? "No se pudo crear la cotización." };

  const merged = new Map<string, { productId: string | null; brand: string; model: string; sku: string | null; quantity: number; msrp: number; salePrice: number }>();
  for (const item of inquiry.items) {
    const product = item.productId ? productsById.get(item.productId) : undefined;
    const key = product?.id ?? item.productId ?? item.id;
    const current = merged.get(key);
    merged.set(key, {
      productId: product?.id ?? item.productId,
      brand: product?.brand ?? item.brand,
      model: product?.model ?? item.model,
      sku: product?.sku ?? null,
      quantity: (current?.quantity ?? 0) + item.quantityRequested,
      msrp: product ? toNumber(product.msrp) : item.salePrice,
      salePrice: product ? toNumber(product.sale_price) : item.salePrice,
    });
  }
  const rows = [...merged.values()].map((item) => ({
    quote_id: quote.id,
    product_id: item.productId,
    brand: item.brand,
    model: item.model,
    sku: item.sku,
    quantity: item.quantity,
    msrp: item.msrp,
    sale_price: item.salePrice,
  }));
  if (rows.length > 0) {
    const { error: itemsError } = await supabase.from("quote_items").insert(rows);
    if (itemsError) return { ok: false as const, message: itemsError.message };
  }

  revalidatePath("/admin/cotizaciones");
  revalidatePath(`/admin/solicitudes/${inquiryId}`);
  return { ok: true as const, id: quote.id };
}

export async function sendQuote(formData: FormData) {
  const saved = await saveQuote(formData);
  if (!saved.ok) return saved;
  const items = parseItems(formData.get("items"));
  if (!items || items.length === 0) return { ok: false as const, message: "Agrega al menos una pieza." };

  const { supabase } = await requireAdmin();
  const quote = await getQuote(saved.id);
  if (!quote) return { ok: false as const, message: "No encontramos la cotización." };

  const pdf = await buildQuotePdf(quote);
  const copyTo = await readInquiryEmail(supabase);
  const sent = await sendQuotePdf(quote, pdf, copyTo);
  if (!sent.ok) return sent;

  const status = quote.status === "borrador" ? "enviada" : quote.status;
  const { error } = await supabase
    .from("quotes")
    .update({ status, sent_at: new Date().toISOString() })
    .eq("id", quote.id);
  if (error) return { ok: false as const, message: error.message };

  revalidatePath("/admin/cotizaciones");
  revalidatePath(`/admin/cotizaciones/${quote.id}`);
  return { ok: true as const, id: quote.id, message: sent.message };
}

export async function confirmQuote(formData: FormData) {
  const saved = await saveQuote(formData);
  if (!saved.ok) return saved;

  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("quotes").select("status").eq("id", saved.id).maybeSingle();
  if (error || !data) return { ok: false as const, message: error?.message ?? "No encontramos la cotización." };
  if (data.status === "despachada") return { ok: false as const, message: "Esta cotización ya fue despachada." };
  if (data.status !== "confirmada") {
    const { error: updateError } = await supabase.from("quotes").update({ status: "confirmada" }).eq("id", saved.id);
    if (updateError) return { ok: false as const, message: updateError.message };
  }

  revalidatePath("/admin/cotizaciones");
  revalidatePath(`/admin/cotizaciones/${saved.id}`);
  return { ok: true as const, id: saved.id };
}

export async function dispatchQuote(formData: FormData) {
  const saved = await saveQuote(formData);
  if (!saved.ok) return saved;

  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("dispatch_quote", { p_quote_id: saved.id });
  if (error) return { ok: false as const, message: error.message };

  const { data: dispatched } = await supabase.from("quotes").select("inquiry_id").eq("id", saved.id).maybeSingle();

  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/admin/productos");
  revalidatePath("/admin/solicitudes");
  revalidatePath("/admin/cotizaciones");
  revalidatePath(`/admin/cotizaciones/${saved.id}`);
  if (dispatched?.inquiry_id) revalidatePath(`/admin/solicitudes/${dispatched.inquiry_id}`);
  return {
    ok: true as const,
    id: saved.id,
    message: dispatched?.inquiry_id
      ? "Despachada. El stock ya bajó y la reserva quedó cerrada."
      : "Despachada. El stock ya bajó.",
  };
}
