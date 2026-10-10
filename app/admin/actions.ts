"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";

function parseMoney(value: FormDataEntryValue | null) {
  const number = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function discountFromPrices(msrp: number, salePrice: number) {
  if (msrp <= 0 || salePrice >= msrp) return 0;
  return Math.min(100, Math.round(((msrp - salePrice) / msrp) * 10000) / 100);
}

export async function saveProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const brand = String(formData.get("brand") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const sku = String(formData.get("sku") ?? "").trim();
  const dimensions = String(formData.get("dimensions") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "");
  const cost = parseMoney(formData.get("cost"));
  const msrpText = String(formData.get("msrp") ?? "").trim();
  const saleText = String(formData.get("sale_price") ?? "").trim();
  const msrp = msrpText === "" ? null : parseMoney(msrpText);
  let salePrice = saleText === "" ? null : parseMoney(saleText);
  const stock = Number(formData.get("stock"));
  const file = formData.get("image");

  if (!brand || !model) return { ok: false as const, message: "Marca y modelo son obligatorios." };
  if (sku.length > 80) return { ok: false as const, message: "El SKU puede tener hasta 80 caracteres." };
  if (dimensions.length > 120) return { ok: false as const, message: "Las dimensiones pueden tener hasta 120 caracteres." };
  const { data: category } = await supabase
    .from("categories")
    .select("id, parent_id")
    .eq("id", categoryId)
    .maybeSingle();
  if (!category?.parent_id) {
    return { ok: false as const, message: "Elige una subcategoría." };
  }
  if (cost === null || (msrpText !== "" && msrp === null) || (saleText !== "" && salePrice === null)) {
    return { ok: false as const, message: "Revisa costo, MSRP y precio de venta." };
  }
  if (msrp != null && salePrice == null) salePrice = Math.round(msrp * 50) / 100;
  if (!Number.isInteger(stock) || stock < 0) {
    return { ok: false as const, message: "El stock tiene que ser un número entero." };
  }
  if (id) {
    const { data: currentProduct } = await supabase.from("products").select("held").eq("id", id).maybeSingle();
    if (currentProduct && stock < Number(currentProduct.held)) {
      return {
        ok: false as const,
        message: "El stock no puede quedar por debajo de la reserva. Devuelve la solicitud al catálogo o despacha la cotización.",
      };
    }
  }

  const payload = {
    brand,
    model,
    sku: sku || null,
    dimensions: dimensions || null,
    description,
    category_id: categoryId,
    cost,
    msrp,
    sale_price: salePrice,
    discount_percent: msrp != null && salePrice != null ? discountFromPrices(msrp, salePrice) : null,
    stock,
  };

  const productId = id || crypto.randomUUID();
  const query = id
    ? supabase.from("products").update(payload).eq("id", id).select("id, image_path").single()
    : supabase.from("products").insert({ id: productId, ...payload }).select("id, image_path").single();

  const { data, error } = await query;
  if (error || !data) return { ok: false as const, message: error?.message ?? "No se pudo guardar." };

  if (file instanceof File && file.size > 0) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) {
      return { ok: false as const, message: "La foto debe ser JPG, PNG o WebP de hasta 5 MB." };
    }
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${data.id}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) return { ok: false as const, message: uploadError.message };

    const previous = data.image_path as string | null;
    const { error: imageError } = await supabase.from("products").update({ image_path: path }).eq("id", data.id);
    if (imageError) return { ok: false as const, message: imageError.message };
    if (previous && previous !== path) await supabase.storage.from("product-images").remove([previous]);
  } else if (String(formData.get("remove_image") ?? "") === "1" && data.image_path) {
    const previous = data.image_path as string;
    const { error: imageError } = await supabase.from("products").update({ image_path: null }).eq("id", data.id);
    if (imageError) return { ok: false as const, message: imageError.message };
    await supabase.storage.from("product-images").remove([previous]);
  }

  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/admin/productos");
  revalidatePath(`/admin/productos/${data.id}`);
  return { ok: true as const, id: data.id as string };
}

export async function deleteProduct(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const imagePath = String(formData.get("image_path") ?? "");
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) return { ok: false as const, message: error.message };
  if (imagePath) await supabase.storage.from("product-images").remove([imagePath]);
  revalidatePath("/");
  revalidatePath("/productos");
  revalidatePath("/admin/productos");
  return { ok: true as const };
}

export async function updateInquiryStatus(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (status !== "en_contacto" && status !== "cancelada") {
    return { ok: false as const, message: "Estado no válido." };
  }

  const { data: current, error: readError } = await supabase
    .from("inquiries")
    .select("status")
    .eq("id", id)
    .single();
  if (readError || !current) return { ok: false as const, message: "Solicitud no encontrada." };
  if (current.status === "surtida") return { ok: false as const, message: "Esta solicitud ya fue surtida." };
  if (current.status === "cancelada") return { ok: false as const, message: "Esta solicitud está cancelada." };

  if (status === "cancelada") {
    const { error } = await supabase.rpc("release_inquiry", { p_inquiry_id: id });
    if (error) return { ok: false as const, message: error.message };
    revalidatePath("/");
    revalidatePath("/productos");
    revalidatePath("/admin/productos");
  } else {
    const { error } = await supabase.from("inquiries").update({ status }).eq("id", id);
    if (error) return { ok: false as const, message: error.message };
  }

  revalidatePath("/admin/solicitudes");
  revalidatePath(`/admin/solicitudes/${id}`);
  return { ok: true as const };
}

export async function saveCategoryImage(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const file = formData.get("image");
  const remove = String(formData.get("remove_image") ?? "") === "1";

  const { data: category, error: readError } = await supabase
    .from("categories")
    .select("id, parent_id, image_path")
    .eq("id", id)
    .maybeSingle();
  if (readError || !category || category.parent_id) {
    return { ok: false as const, message: "Categoría no encontrada." };
  }

  if (file instanceof File && file.size > 0) {
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) {
      return { ok: false as const, message: "La foto debe ser JPG, PNG o WebP de hasta 5 MB." };
    }
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `categories/${category.id}/${Date.now()}.${extension}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) return { ok: false as const, message: uploadError.message };

    const previous = category.image_path as string | null;
    const { error: updateError } = await supabase.from("categories").update({ image_path: path }).eq("id", category.id);
    if (updateError) return { ok: false as const, message: updateError.message };
    if (previous && previous !== path) await supabase.storage.from("product-images").remove([previous]);
  } else if (remove && category.image_path) {
    const previous = category.image_path as string;
    const { error: updateError } = await supabase.from("categories").update({ image_path: null }).eq("id", category.id);
    if (updateError) return { ok: false as const, message: updateError.message };
    await supabase.storage.from("product-images").remove([previous]);
  } else {
    return { ok: false as const, message: "Elige una foto." };
  }

  revalidatePath("/");
  revalidatePath("/admin/categorias");
  return { ok: true as const };
}

export async function saveInquiryEmail(formData: FormData) {
  const { supabase } = await requireAdmin();
  const email = String(formData.get("inquiry_email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return { ok: false as const, message: "Escribe un correo válido." };
  }
  const { error } = await supabase.from("outlet_settings").update({ inquiry_email: email }).eq("id", 1);
  if (error) return { ok: false as const, message: error.message };
  revalidatePath("/admin/solicitudes");
  return { ok: true as const };
}

export async function signOut() {
  const { supabase } = await requireAdmin();
  await supabase.auth.signOut();
  redirect("/auth/sign-in");
}
