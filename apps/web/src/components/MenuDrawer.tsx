import { esCL } from "@/i18n/es-CL";

interface MenuDrawerProps {
  open: boolean;
  view: "menu" | "curatoria";
  familyMode: boolean;
  onClose: () => void;
  onViewChange: (view: "menu" | "curatoria") => void;
  onToggleFamilyMode: () => void;
}

// Mobile: the hamburger opens this on the "menu" view (Curatoria link +
// Modo familiar toggle, since neither is shown inline on mobile). Desktop:
// the header's "Curatoria" label opens this directly on the "curatoria"
// view instead of a separate destination — same component, two entry
// points, per the redesign's confirmed decision.
export default function MenuDrawer({ open, view, familyMode, onClose, onViewChange, onToggleFamilyMode }: MenuDrawerProps) {
  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => {
          onClose();
          setTimeout(() => onViewChange("menu"), 300);
        }}
      />
      <div
        className={`fixed top-0 right-0 bottom-0 z-40 w-72 bg-white px-5 py-4 shadow-lg transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {view === "menu" ? (
          <>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-bold text-heading-gray">{esCL.menu}</p>
              <button onClick={onClose} className="text-muted-gray text-sm">
                ✕
              </button>
            </div>
            <button
              onClick={() => onViewChange("curatoria")}
              className="w-full text-left text-sm text-heading-gray py-2.5 border-b border-stone-200 flex items-center justify-between"
            >
              <span>{esCL.curatoria}</span>
              <span className="text-stone-300">›</span>
            </button>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-heading-gray">{esCL.familyMode}</span>
              <button
                onClick={onToggleFamilyMode}
                className={`w-10 h-6 rounded-full relative transition-colors ${familyMode ? "bg-city-pill-bg" : "bg-stone-300"}`}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    familyMode ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => onViewChange("menu")} className="text-heading-gray text-lg">
                ←
              </button>
              <p className="text-sm font-bold text-heading-gray">{esCL.curatoria}</p>
            </div>
            <p className="text-sm text-muted-gray leading-relaxed">{esCL.curatoriaText}</p>
          </>
        )}
      </div>
    </>
  );
}
