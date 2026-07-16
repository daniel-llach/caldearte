import { esCL } from "@/i18n/es-CL";
import { citiesWithEvents, type City } from "@/lib/cities";
import type { CityCounts } from "@/lib/events";

interface CityPickerPanelProps {
  open: boolean;
  cityId: string;
  cityCounts: Record<string, CityCounts>;
  onClose: () => void;
  onSelect: (city: City) => void;
}

export default function CityPickerPanel({ open, cityId, cityCounts, onClose, onSelect }: CityPickerPanelProps) {
  const cities = citiesWithEvents(cityCounts, { alwaysIncludeCityId: cityId });

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />
      <div
        className={`fixed top-0 left-0 right-0 z-40 bg-white px-5 py-4 shadow-lg transition-transform duration-300 ease-out ${
          open ? "translate-y-0" : "-translate-y-full"
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-bold text-heading-gray">{esCL.chooseCity}</p>
          <button onClick={onClose} className="text-muted-gray text-sm">
            ✕
          </button>
        </div>
        {cities.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className={`w-full text-left text-sm px-3 py-2.5 rounded-lg mb-1 transition-colors ${
              c.id === cityId ? "bg-city-pill-bg text-city-pill-fg" : "text-heading-gray hover:bg-stone-100"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
    </>
  );
}
