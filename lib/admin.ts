import { requireAdmin } from "@/lib/auth";
import { readInquiryEmail } from "@/lib/inquiry-email";
import { getCategories, mapAdminProduct } from "@/lib/catalog";
import { productImageUrl, toNumber } from "@/lib/format";
import type { AdminProduct, Inquiry, InquiryItem, InquiryStatus, ProductCategoryNode } from "@/lib/types";

const ADMIN_COLUMNS =
  "id, brand, model, sku, dimensions, description, category, category_id, cost, msrp, discount_percent, sale_price, stock, held, image_path";

function withCategoryName(
  product: ReturnType<typeof mapAdminProduct>,
  categories: ProductCategoryNode[]
): AdminProduct {
  return {
    ...product,
    categoryName: categories.find((category) => category.id === product.categoryId)?.name ?? "",
  };
}

export async function getAdminProducts() {
  const { supabase } = await requireAdmin();
  const [{ data, error }, categories] = await Promise.all([
    supabase.from("products").select(ADMIN_COLUMNS).order("brand").order("model"),
    getCategories(),
  ]);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => withCategoryName(mapAdminProduct(row), categories));
}

export async function getAdminProduct(id: string) {
  const { supabase } = await requireAdmin();
  const [{ data, error }, categories] = await Promise.all([
    supabase.from("products").select(ADMIN_COLUMNS).eq("id", id).maybeSingle(),
    getCategories(),
  ]);
  if (error) throw new Error(error.message);
  return data ? withCategoryName(mapAdminProduct(data), categories) : null;
}

type InquiryRow = {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  note: string | null;
  status: InquiryStatus;
  created_at: string;
  inquiry_items: {
    id: string;
    product_id: string | null;
    brand: string;
    model: string;
    quantity_requested: number;
    quantity_fulfilled: number;
    sale_price: number | string;
  }[];
};

function mapInquiry(row: InquiryRow): Inquiry {
  const items: InquiryItem[] = (row.inquiry_items ?? []).map((item) => ({
    id: item.id,
    productId: item.product_id,
    brand: item.brand,
    model: item.model,
    sku: null,
    quantityRequested: item.quantity_requested,
    quantityFulfilled: item.quantity_fulfilled,
    msrp: toNumber(item.sale_price),
    salePrice: toNumber(item.sale_price),
    imageUrl: null,
  }));

  return {
    id: row.id,
    name: row.name,
    company: row.company,
    email: row.email,
    phone: row.phone,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    items,
  };
}

const INQUIRY_SELECT =
  "id, name, company, email, phone, note, status, created_at, inquiry_items(id, product_id, brand, model, quantity_requested, quantity_fulfilled, sale_price)";

export async function getInquiryEmailSetting() {
  const { supabase } = await requireAdmin();
  return readInquiryEmail(supabase);
}

export async function getInquiries() {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("inquiries").select(INQUIRY_SELECT).order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as InquiryRow[]).map(mapInquiry);
}

export async function getInquiry(id: string) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from("inquiries").select(INQUIRY_SELECT).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return attachInquiryProducts(supabase, mapInquiry(data as InquiryRow));
}

async function attachInquiryProducts(
  supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"],
  inquiry: Inquiry
) {
  const ids = inquiry.items.map((item) => item.productId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return inquiry;
  const { data, error } = await supabase.from("products").select("id, sku, msrp, image_path").in("id", ids);
  if (error) throw new Error(error.message);
  const products = new Map(
    (data ?? []).map((product) => [
      product.id,
      { sku: product.sku as string | null, msrp: toNumber(product.msrp), imageUrl: productImageUrl(product.image_path) },
    ])
  );
  return {
    ...inquiry,
    items: inquiry.items.map((item) => {
      const product = item.productId ? products.get(item.productId) : undefined;
      if (!product) return item;
      return { ...item, sku: product.sku, msrp: product.msrp, imageUrl: product.imageUrl };
    }),
  };
}

export async function getAdminSummary() {
  const products = await getAdminProducts();
  const inquiries = await getInquiries();
  return {
    products: products.length,
    outOfStock: products.filter((product) => product.stock === 0).length,
    openInquiries: inquiries.filter((inquiry) => inquiry.status === "nueva" || inquiry.status === "en_contacto").length,
  };
}

export type { AdminProduct };
