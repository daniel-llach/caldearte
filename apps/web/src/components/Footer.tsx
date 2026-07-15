import { esCL } from "@/i18n/es-CL";

export default function Footer() {
  return (
    <footer className="mt-16 pt-6 border-t border-stone-200 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
      <div>
        <p className="text-base font-bold text-heading-gray">{esCL.appName}</p>
        <p className="text-xs text-muted-gray mt-1">{esCL.footer.tagline}</p>
        <p className="text-xs text-muted-gray mt-1">{esCL.footer.copyright(new Date().getFullYear())}</p>
      </div>
      {/* TODO gap: real destinations for these links don't exist yet — see the frontend plan's decision #6. */}
      <div className="flex gap-6 text-xs text-muted-gray">
        <a href="#">{esCL.footer.acercaDe}</a>
        <a href="#">{esCL.footer.contacto}</a>
        <a href="#">{esCL.footer.instagram}</a>
      </div>
    </footer>
  );
}
