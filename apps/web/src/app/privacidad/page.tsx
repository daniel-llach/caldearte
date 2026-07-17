import type { Metadata } from "next";
import Link from "next/link";
import { esCL } from "@/i18n/es-CL";

export const metadata: Metadata = { title: `${esCL.privacidad.title} — ${esCL.appName}` };

export default function PrivacidadPage() {
  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 md:px-[61px] max-w-[720px] mx-auto">
      <Link href="/" className="text-sm text-muted-gray">
        ← {esCL.appName}
      </Link>
      <h1 className="text-3xl font-black text-heading-gray mt-6 mb-8">{esCL.privacidad.title}</h1>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-heading-gray mb-2">{esCL.privacidad.dataTitle}</h2>
        <p className="text-sm text-muted-gray leading-relaxed">{esCL.privacidad.dataBody}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-bold text-heading-gray mb-2">{esCL.privacidad.curationTitle}</h2>
        <p className="text-sm text-muted-gray leading-relaxed">{esCL.curatoriaText}</p>
      </section>

      <section>
        <h2 className="text-lg font-bold text-heading-gray mb-2">{esCL.privacidad.contactTitle}</h2>
        <p className="text-sm text-muted-gray leading-relaxed">
          {esCL.privacidad.contactBody}
          <Link href="/contacto" className="underline text-heading-gray">
            {esCL.privacidad.contactLinkLabel}
          </Link>
          .
        </p>
      </section>
    </main>
  );
}
