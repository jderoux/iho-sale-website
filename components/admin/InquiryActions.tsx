"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateInquiryStatus } from "@/app/admin/actions";
import type { Inquiry } from "@/lib/types";

export function InquiryActions({ inquiry }: { inquiry: Inquiry }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locked = inquiry.status === "surtida" || inquiry.status === "cancelada";

  async function run(action: (formData: FormData) => Promise<{ ok: boolean; message?: string }>, formData: FormData) {
    setPending(true);
    setError(null);
    const result = await action(formData);
    setPending(false);
    if (!result.ok) {
      setError(result.message ?? "No se pudo actualizar.");
      return;
    }
    router.refresh();
  }

  if (locked && !error) return null;

  return (
    <>
      {error && <p className="w-full text-sm text-arquiluz-accent">{error}</p>}
      {!locked && (
        <>
          {inquiry.status === "nueva" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                const data = new FormData();
                data.set("id", inquiry.id);
                data.set("status", "en_contacto");
                void run(updateInquiryStatus, data);
              }}
              className="border border-arquiluz-black px-5 py-2 text-sm"
            >
              Marcar en contacto
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              const data = new FormData();
              data.set("id", inquiry.id);
              data.set("status", "cancelada");
              void run(updateInquiryStatus, data);
            }}
            className="px-5 py-2 text-sm text-gray-500"
          >
            Devolver al catálogo
          </button>
        </>
      )}
    </>
  );
}
