export type ProductCategory = "mobiliario" | "accesorio";
export type InquiryStatus = "nueva" | "en_contacto" | "surtida" | "cancelada";
export type QuoteStatus = "borrador" | "enviada" | "confirmada" | "despachada";

export type ProductCategoryNode = {
  id: string;
  parentId: string | null;
  slug: string;
  name: string;
  sortOrder: number;
  imagePath: string | null;
};

export type CatalogCategoryGroup = {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
};

export type CatalogProduct = {
  id: string;
  brand: string;
  model: string;
  sku: string | null;
  dimensions: string | null;
  description: string;
  category: ProductCategory;
  categoryId: string;
  msrp: number;
  discountPercent: number;
  salePrice: number;
  stock: number;
  imagePath: string | null;
};

export type AdminProduct = Omit<CatalogProduct, "msrp" | "discountPercent" | "salePrice"> & {
  cost: number;
  categoryName: string;
  held: number;
  msrp: number | null;
  discountPercent: number | null;
  salePrice: number | null;
};

export type InquiryItem = {
  id: string;
  productId: string | null;
  brand: string;
  model: string;
  sku: string | null;
  quantityRequested: number;
  quantityFulfilled: number;
  msrp: number;
  salePrice: number;
  imageUrl: string | null;
};

export type Inquiry = {
  id: string;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  note: string | null;
  status: InquiryStatus;
  createdAt: string;
  items: InquiryItem[];
};

export type QuoteItem = {
  id: string;
  productId: string | null;
  brand: string;
  model: string;
  sku: string | null;
  quantity: number;
  msrp: number;
  salePrice: number;
  imageUrl: string | null;
};

export type Quote = {
  id: string;
  number: number;
  inquiryId: string | null;
  name: string;
  company: string | null;
  email: string;
  phone: string;
  note: string | null;
  shipping: number;
  status: QuoteStatus;
  sentAt: string | null;
  createdAt: string;
  items: QuoteItem[];
};

export type QuoteProductOption = {
  id: string;
  brand: string;
  model: string;
  sku: string | null;
  msrp: number;
  salePrice: number;
  stock: number;
  imageUrl: string | null;
};

export type SelectionDraft = {
  productId: string;
  brand: string;
  model: string;
  msrp: number;
  salePrice: number;
  stock: number;
  imageUrl: string | null;
  quantity: number;
};
