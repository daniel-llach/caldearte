import { esCL } from "@/i18n/es-CL";

export interface ArchiveFilters {
  desde: string; // "YYYY-MM-DD", clamped to the viewed month's bounds
  hasta: string;
  lugar: string;
  comuna: string; // "" = todas
}

interface FilterDrawerProps {
  open: boolean;
  filters: ArchiveFilters;
  comunas: string[]; // distinct región names present in this month's events, already sorted
  monthStart: string;
  monthEnd: string;
  onChange: (filters: ArchiveFilters) => void;
  onClose: () => void;
}

// Same slide-in-from-the-right shape as MenuDrawer.tsx (backdrop + fixed
// panel) — deliberately NOT CityPickerPanel's full-screen/combobox
// pattern, since these are plain form fields, not a searchable list.
// Filters apply instantly on every change (no staged "Explorar" commit
// like the city picker): this is a pure in-memory array filter with no
// cookie write or navigation, so there's no cost worth confirming before
// applying.
export default function FilterDrawer({ open, filters, comunas, monthStart, monthEnd, onChange, onClose }: FilterDrawerProps) {
  function clear() {
    onChange({ desde: monthStart, hasta: monthEnd, lugar: "", comuna: "" });
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={esCL.archiveFiltersAriaLabel}
        inert={!open}
        className={`fixed top-0 right-0 bottom-0 z-40 w-80 bg-white px-5 py-4 shadow-lg overflow-y-auto transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-bold text-heading-gray">{esCL.archiveFilters.title}</p>
          <button onClick={onClose} className="text-muted-gray text-sm">
            ✕
          </button>
        </div>

        <label className="block text-xs font-medium text-muted-gray mb-1">{esCL.archiveFilters.desde}</label>
        <input
          type="date"
          min={monthStart}
          max={filters.hasta}
          value={filters.desde}
          onChange={(e) => onChange({ ...filters, desde: e.target.value })}
          className="w-full text-sm px-3 py-2 mb-3 rounded-lg bg-picker-subtle border border-picker-border text-heading-gray focus:outline-none"
        />

        <label className="block text-xs font-medium text-muted-gray mb-1">{esCL.archiveFilters.hasta}</label>
        <input
          type="date"
          min={filters.desde}
          max={monthEnd}
          value={filters.hasta}
          onChange={(e) => onChange({ ...filters, hasta: e.target.value })}
          className="w-full text-sm px-3 py-2 mb-3 rounded-lg bg-picker-subtle border border-picker-border text-heading-gray focus:outline-none"
        />

        <label className="block text-xs font-medium text-muted-gray mb-1">{esCL.archiveFilters.lugar}</label>
        <input
          type="text"
          value={filters.lugar}
          onChange={(e) => onChange({ ...filters, lugar: e.target.value })}
          className="w-full text-sm px-3 py-2 mb-3 rounded-lg bg-picker-subtle border border-picker-border text-heading-gray placeholder:text-picker-placeholder focus:outline-none"
        />

        <label className="block text-xs font-medium text-muted-gray mb-1">{esCL.archiveFilters.comuna}</label>
        <select
          value={filters.comuna}
          onChange={(e) => onChange({ ...filters, comuna: e.target.value })}
          className="w-full text-sm px-3 py-2 mb-4 rounded-lg bg-picker-subtle border border-picker-border text-heading-gray focus:outline-none"
        >
          <option value="">{esCL.archiveFilters.comunaAll}</option>
          {comunas.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <button onClick={clear} className="w-full text-sm text-center text-muted-gray underline py-2">
          {esCL.archiveFilters.clear}
        </button>
      </div>
    </>
  );
}
