import Link from "next/link";
import { esCL } from "@/i18n/es-CL";

interface MenuDrawerProps {
  open: boolean;
  familyMode: boolean;
  onClose: () => void;
  onToggleFamilyMode: () => void;
}

// Mobile-only: the hamburger opens this (Curatoria link + Modo familiar
// toggle, neither shown inline on mobile). Curatoria links out to
// /privacidad rather than duplicating that page's content in a second
// place — this drawer used to have its own "curatoria" view with the same
// text as /privacidad's "Cómo curamos" section.
export default function MenuDrawer({ open, familyMode, onClose, onToggleFamilyMode }: MenuDrawerProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 right-0 bottom-0 z-40 w-72 bg-white px-5 py-4 shadow-lg transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-heading-gray">{esCL.menu}</p>
          <button onClick={onClose} className="text-muted-gray text-sm">
            ✕
          </button>
        </div>
        <Link href="/privacidad" onClick={onClose} className="w-full text-left text-sm text-heading-gray py-2.5 border-b border-stone-200 flex items-center justify-between">
          <span>{esCL.curatoria}</span>
          <span className="text-stone-300">›</span>
        </Link>
        <div className="flex items-center justify-between py-2.5">
          <span className="text-sm text-heading-gray">{esCL.familyMode}</span>
          <button
            onClick={onToggleFamilyMode}
            className={`appearance-none flex items-center shrink-0 w-10 h-6 p-0.5 rounded-full transition-colors border-2 ${
              familyMode ? "justify-end bg-city-pill-bg border-city-pill-bg" : "justify-start bg-white border-stone-300"
            }`}
          >
            <span className={`w-5 h-5 rounded-full ${familyMode ? "bg-white" : "bg-stone-300"}`} />
          </button>
        </div>
      </div>
    </>
  );
}
