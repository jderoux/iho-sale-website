import Link from "next/link";
import { notFound } from "next/navigation";
import { CreateQuoteButton } from "@/components/admin/CreateQuoteButton";
import { InquiryActions } from "@/components/admin/InquiryActions";
import { SalePrice } from "@/components/SalePrice";
import { getInquiry } from "@/lib/admin";
import { formatUSD, quoteTotals, statusLabel } from "@/lib/format";
import { getQuoteIdForInquiry } from "@/lib/quotes";

export const dynamic = "force-dynamic";

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const inquiry = await getInquiry(id);
  if (!inquiry) notFound();
  const quoteId = await getQuoteIdForInquiry(id);
  const totals = quoteTotals(
    inquiry.items.map((item) => ({ msrp: item.msrp, salePrice: item.salePrice, quantity: item.quantityRequested })),
    0
  );

  return (
    <main className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-arquiluz-accent">{statusLabel(inquiry.status)}</p>
          <h1 className="mt-2 font-serif text-4xl">{inquiry.name}</h1>
        </div>
        <Link href="/admin/solicitudes" className="text-sm font-medium text-arquiluz-accent">
          Volver
        </Link>
      </div>

      <div className="grid gap-4 border border-black/10 bg-white p-5 md:grid-cols-2">
        <StaticField label="Nombre" value={inquiry.name} />
        <StaticField label="Empresa" value={inquiry.company ?? ""} />
        <StaticField label="Correo" value={inquiry.email} />
        <StaticField label="Teléfono" value={inquiry.phone} />
        <div className="text-sm md:col-span-2">
          <p className="mb-1 text-xs uppercase tracking-wider text-gray-500">Nota</p>
          <p className="min-h-24 whitespace-pre-wrap border border-black/10 px-3 py-2">{inquiry.note ?? ""}</p>
        </div>
      </div>

      <div className="border border-black/10 bg-white p-5">
        <div className="divide-y divide-black/10">
          {inquiry.items.map((item) => (
            <div key={item.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-14 w-14 shrink-0 bg-arquiluz-gray">
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.imageUrl} alt="" className="h-full w-full object-contain" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wider text-gray-500">{item.brand}</p>
                  <p>{item.model}</p>
                  {item.sku && <p className="text-sm text-gray-500">{item.sku}</p>}
                  <SalePrice msrp={item.msrp} salePrice={item.salePrice} prominent={false} align="left" />
                </div>
              </div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                Cantidad
                <span className="ml-2 text-sm normal-case tracking-normal text-arquiluz-black">{item.quantityRequested}</span>
                {inquiry.status === "surtida" && (
                  <span className="mt-1 block normal-case tracking-normal">Surtidas: {item.quantityFulfilled}</span>
                )}
              </div>
            </div>
          ))}
          {inquiry.items.length === 0 && <p className="py-4 text-sm text-gray-500">Esta solicitud no tiene piezas.</p>}
        </div>
      </div>

      <div className="grid gap-6 border border-black/10 bg-white p-5 md:grid-cols-[16rem_1fr] md:items-start">
        <div className="text-sm">
          <p className="mb-1 text-xs uppercase tracking-wider text-gray-500">Envío</p>
          <p className="border border-black/10 px-3 py-2">0</p>
        </div>
        <div>
          <dl className="space-y-2 text-sm">
            <Row label="Precio de lista" value={formatUSD(totals.listTotal)} />
            <Row label="Descuento" value={`-${formatUSD(totals.discount)}`} accent />
            <Row label="Subtotal" value={formatUSD(totals.subtotal)} />
            <Row label="Envío" value={formatUSD(totals.shipping)} />
            <Row label="ITBMS 7%" value={formatUSD(totals.itbms)} />
            <div className="flex items-baseline justify-between gap-6 font-serif text-2xl">
              <dt>A pagar</dt>
              <dd>{formatUSD(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-gray-500">El ITBMS del 7% aplica sobre las piezas y el envío.</p>
          <p className="mt-1 text-sm text-gray-500">No incluye costos de entrega. El precio es para retirar en tienda.</p>
        </div>
      </div>

      {(inquiry.status === "nueva" || inquiry.status === "en_contacto") && (
        <p className="text-sm text-gray-600">Estas unidades están reservadas y no salen en el outlet.</p>
      )}

      <div className="flex flex-wrap items-start gap-3">
        {quoteId ? (
          <Link href={`/admin/cotizaciones/${quoteId}`} className="bg-arquiluz-black px-5 py-2 text-sm text-white">
            Ver cotización
          </Link>
        ) : (
          <CreateQuoteButton inquiryId={inquiry.id} />
        )}
        <InquiryActions inquiry={inquiry} />
      </div>
    </main>
  );
}

function StaticField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <p className="mb-1 text-xs uppercase tracking-wider text-gray-500">{label}</p>
      <p className="min-h-10 border border-black/10 px-3 py-2">{value}</p>
    </div>
  );
}

function Row({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6">
      <dt className="text-gray-500">{label}</dt>
      <dd className={accent ? "text-arquiluz-accent" : undefined}>{value}</dd>
    </div>
  );
}
