"use client";

import { useRef, useState } from "react";
import { esCL } from "@/i18n/es-CL";
import { citiesWithEvents } from "@/lib/cities";
import type { CityCounts } from "@/lib/events";

interface CityCarouselProps {
  cityCounts: Record<string, CityCounts>;
  excludeCityId: string;
  onSelectCity: (cityId: string) => void;
}

// Scroll-snap carousel, not the ResizeObserver-driven grid mechanism —
// this is an overflow-x layout, not a CSS grid needing an exact column
// count. "Otro" is never shown here (no sensible "Explorar" destination).
// A city with nothing to show today (0 inauguraciones AND 0 exposiciones)
// isn't a real "explore this" destination either — "muestra lo que hay".
export default function CityCarousel({ cityCounts, excludeCityId, onSelectCity }: CityCarouselProps) {
  const cities = citiesWithEvents(cityCounts, { excludeCityId });
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeDot, setActiveDot] = useState(0);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el || cities.length === 0) return;
    const cardWidth = el.scrollWidth / cities.length;
    setActiveDot(Math.min(cities.length - 1, Math.round(el.scrollLeft / cardWidth)));
  }

  if (cities.length === 0) return null;

  return (
    <section className="mt-16">
      <h2 className="text-2xl md:text-[34px] font-black tracking-wide text-heading-gray mb-6">{esCL.sectionArteEnTodasPartes}</h2>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2"
        style={{ scrollbarWidth: "none" }}
      >
        {cities.map((city) => {
          const counts = cityCounts[city.id] ?? { inauguraciones: 0, exposActuales: 0 };
          return (
            <button
              key={city.id}
              onClick={() => onSelectCity(city.id)}
              className="snap-start shrink-0 w-[85%] sm:w-[46%] md:w-[31%] text-left bg-white rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.1)] p-4 flex flex-col gap-2.5"
            >
              <p className="text-lg font-bold text-heading-gray">{city.name}</p>
              <p className="text-sm text-muted-gray">{esCL.cityStats(counts.inauguraciones, counts.exposActuales)}</p>
              <span className="text-sm font-semibold text-heading-gray">{esCL.explorar} →</span>
            </button>
          );
        })}
      </div>
      <div className="flex justify-center gap-2 mt-4">
        {cities.map((c, i) => (
          <span key={c.id} className={`w-2 h-2 rounded-full ${i === activeDot ? "bg-dot-active" : "bg-dot-inactive"}`} />
        ))}
      </div>
    </section>
  );
}
