import { productImageUrl, toNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import type { CatalogCategoryGroup, CatalogProduct, ProductCategory, ProductCategoryNode } from "@/lib/types";

const PUBLIC_COLUMNS =
  "id, brand, model, sku, dimensions, description, category, category_id, msrp, discount_percent, sale_price, stock, available, image_path";

type ProductRow = {
  id: string;
  brand: string;
  model: string;
  sku: string | null;
  dimensions: string | null;
  description: string;
  category: ProductCategory;
  category_id: string;
  msrp: number | string;
  discount_percent: number | string;
  sale_price: number | string;
  stock: number;
  available?: number;
  held?: number;
  image_path: string | null;
  cost?: number | string;
};

export function mapProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    sku: row.sku?.trim() || null,
    dimensions: row.dimensions?.trim() || null,
    description: row.description,
    category: row.category,
    categoryId: row.category_id,
    msrp: toNumber(row.msrp),
    discountPercent: toNumber(row.discount_percent),
    salePrice: toNumber(row.sale_price),
    stock: row.stock,
    imagePath: row.image_path,
  };
}

export function mapAdminProduct(row: ProductRow) {
  return {
    ...mapProduct(row),
    cost: toNumber(row.cost),
    msrp: row.msrp == null || row.msrp === "" ? null : toNumber(row.msrp),
    discountPercent: row.discount_percent == null || row.discount_percent === "" ? null : toNumber(row.discount_percent),
    salePrice: row.sale_price == null || row.sale_price === "" ? null : toNumber(row.sale_price),
    held: toNumber(row.held),
  };
}

type CategoryRow = {
  id: string;
  parent_id: string | null;
  slug: string;
  name: string;
  sort_order: number;
  image_path: string | null;
};

function mapCategory(row: CategoryRow): ProductCategoryNode {
  return {
    id: row.id,
    parentId: row.parent_id,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sort_order,
    imagePath: row.image_path,
  };
}

export async function getCategories() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("id, parent_id, slug, name, sort_order, image_path")
    .order("sort_order");
  if (error) throw new Error(error.message);
  return ((data ?? []) as CategoryRow[]).map(mapCategory);
}

export function categoryIdsForSlug(categories: ProductCategoryNode[], slug: string) {
  const selected = categories.find((category) => category.slug === slug);
  if (!selected) return null;
  if (!selected.parentId) {
    return categories.filter((category) => category.parentId === selected.id).map((category) => category.id);
  }
  return [selected.id];
}

export function catalogCategoryTree(categories: ProductCategoryNode[], counts: Map<string, number>): CatalogCategoryGroup[] {
  return categories
    .filter((category) => !category.parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((parent) => ({
      slug: parent.slug,
      name: parent.name,
      children: categories
        .filter((category) => category.parentId === parent.id && (counts.get(category.id) ?? 0) > 0)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((category) => ({ slug: category.slug, name: category.name })),
    }))
    .filter((group) => group.children.length > 0);
}

export async function getInStockCategoryCounts() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("category_id").gt("available", 0).not("sale_price", "is", null);
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const id = row.category_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function getCatalog(filters: {
  q?: string;
  brand?: string;
  categoryIds?: string[] | null;
  min?: number | null;
  max?: number | null;
}) {
  if (filters.categoryIds && filters.categoryIds.length === 0) return [];

  const supabase = await createClient();
  let query = supabase
    .from("products")
    .select(PUBLIC_COLUMNS)
    .gt("available", 0)
    .not("sale_price", "is", null)
    .order("brand")
    .order("model");

  if (filters.categoryIds) {
    query = query.in("category_id", filters.categoryIds);
  }
  if (filters.min != null) query = query.gte("sale_price", filters.min);
  if (filters.max != null) query = query.lte("sale_price", filters.max);
  if (filters.brand) {
    query = query.eq("brand", filters.brand);
  }
  if (filters.q) {
    const term = filters.q.replace(/[%_,]/g, "").trim();
    if (term) {
      query = query.or(`brand.ilike.%${term}%,model.ilike.%${term}%`);
    }
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ProductRow[]).map((row) => ({ ...mapProduct(row), stock: toNumber(row.available) }));
}

export async function getCatalogBrands() {
  const supabase = await createClient();
  const { data, error } = await supabase.from("products").select("brand").gt("available", 0).not("sale_price", "is", null);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((row) => row.brand as string))].sort((a, b) =>
    a.localeCompare(b, "es")
  );
}

export function selectionFromProduct(product: CatalogProduct) {
  return {
    productId: product.id,
    brand: product.brand,
    model: product.model,
    msrp: product.msrp,
    salePrice: product.salePrice,
    stock: product.stock,
    imageUrl: productImageUrl(product.imagePath),
    quantity: 1,
  };
}
