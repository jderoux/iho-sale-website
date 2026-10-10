import Link from "next/link";
import { getAdminProducts } from "@/lib/admin";
import { formatUSD, productImageUrl, properCase } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ProductsPage() {
  const products = await getAdminProducts();

  return (
    <main>
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-serif text-4xl">Productos</h1>
        <Link href="/admin/productos/nuevo" className="bg-arquiluz-black px-4 py-2 text-sm text-white">
          Agregar
        </Link>
      </div>
      <div className="mt-8 overflow-x-auto bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-black/10 text-xs uppercase tracking-wider text-gray-500">
            <tr>
              <th className="px-4 py-3 font-medium">Pieza</th>
              <th className="px-4 py-3 font-medium">Categoría</th>
              <th className="px-4 py-3 font-medium">Dimensiones</th>
              <th className="px-4 py-3 font-medium">Costo</th>
              <th className="px-4 py-3 font-medium">MSRP</th>
              <th className="px-4 py-3 font-medium">Venta</th>
              <th className="px-4 py-3 font-medium">Stock</th>
              <th className="px-4 py-3 font-medium">Reserva</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => {
              const imageUrl = productImageUrl(product.imagePath);
              return (
                <tr key={product.id} className="border-b border-black/5">
                  <td className="px-4 py-3">
                    <Link href={`/admin/productos/${product.id}`} className="flex items-center gap-3 hover:text-arquiluz-accent">
                      <span className="h-12 w-12 shrink-0 bg-arquiluz-gray">
                        {imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
                        )}
                      </span>
                      <span>
                        <span className="block text-xs tracking-wider text-gray-500">{properCase(product.brand)}</span>
                        <span className="font-medium">
                          {product.model}
                          {product.sku && <span className="ml-2 font-normal text-gray-500">{product.sku}</span>}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3">{product.categoryName}</td>
                  <td className="px-4 py-3 text-gray-600">{product.dimensions}</td>
                  <td className="px-4 py-3">{formatUSD(product.cost)}</td>
                  <td className="px-4 py-3">{product.msrp == null ? "" : formatUSD(product.msrp)}</td>
                  <td className="px-4 py-3">
                    {product.salePrice == null ? "" : formatUSD(product.salePrice)}
                    {product.discountPercent != null && product.discountPercent > 0 && (
                      <span className="ml-2 text-xs text-gray-500">-{product.discountPercent}%</span>
                    )}
                  </td>
                  <td className="px-4 py-3">{product.stock}</td>
                  <td className="px-4 py-3">{product.held > 0 ? product.held : ""}</td>
                </tr>
              );
            })}
            {products.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-gray-500">
                  Todavía no hay piezas.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
