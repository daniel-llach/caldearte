"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { esCL } from "@/i18n/es-CL";
import { cityById, type City } from "@/lib/cities";
import { CITY_COOKIE, FAMILY_MODE_COOKIE } from "@/lib/cookies";
import { fmtShort } from "@/lib/date";
import type { CityCounts, EventRecord, RegionMeta } from "@/lib/events";
import Header from "./Header";
import InauguracionCard from "./InauguracionCard";
import ExpoCard from "./ExpoCard";
import CityCarousel from "./CityCarousel";
import Footer from "./Footer";
import CityPickerPanel from "./CityPickerPanel";
import MenuDrawer from "./MenuDrawer";

interface CalendarViewProps {
  inauguraciones: EventRecord[];
  exposActuales: EventRecord[];
  cityId: string;
  cityNames: Record<string, string>; // real observed comuna names, id -> name — see cities.ts
  familyMode: boolean;
  today: string; // YYYY-MM-DD, computed server-side for SSR/CSR consistency
  cityCounts: Record<string, CityCounts>;
  nextEvent: EventRecord | null; // empty-state fallback, beyond "today"
  regions: RegionMeta[]; // for the city picker's región grouping
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

const DESKTOP_BREAKPOINT = 768;

export default function CalendarView({
  inauguraciones,
  exposActuales,
  cityId,
  cityNames,
  familyMode,
  today,
  cityCounts,
  nextEvent,
  regions,
}: CalendarViewProps) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const cityPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [isDesktop, setIsDesktop] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const city = cityById(cityId, cityNames);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      setIsDesktop(entries[0].contentRect.width >= DESKTOP_BREAKPOINT);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function goToCity(nextCityId: string) {
    setCookie(CITY_COOKIE, nextCityId);
    setLocationOpen(false);
    router.refresh();
  }

  function selectCity(next: City) {
    goToCity(next.id);
  }

  function toggleFamilyMode() {
    setCookie(FAMILY_MODE_COOKIE, familyMode ? "" : "1");
    router.refresh();
  }

  const isEmpty = inauguraciones.length === 0 && exposActuales.length === 0;

  return (
    <div ref={containerRef} className="w-full relative">
      <Header
        city={city}
        familyMode={familyMode}
        today={today}
        inauguracionesCount={inauguraciones.length}
        exposCount={exposActuales.length}
        onOpenCityPicker={() => setLocationOpen(true)}
        cityPickerTriggerRef={cityPickerTriggerRef}
        onOpenMobileMenu={() => setDrawerOpen(true)}
        onToggleFamilyMode={toggleFamilyMode}
      />

      {isEmpty ? (
        <div className="py-10">
          {nextEvent ? (
            <p className="text-sm text-heading-gray">
              {esCL.emptyWithNextEvent(
                city.name,
                nextEvent.openingDatetime ? fmtShort(nextEvent.openingDatetime.slice(0, 10)) : fmtShort(nextEvent.runStartDate ?? today),
                nextEvent.title,
              )}
            </p>
          ) : (
            <>
              <p className="text-sm text-heading-gray mb-2">{esCL.emptyNoEventsYet(city.name)}</p>
              <p className="text-xs text-muted-gray mb-3">{esCL.doYouKnowOne}</p>
              <button className="text-xs px-3 py-1.5 rounded-full bg-city-pill-bg text-city-pill-fg">{esCL.tellUs}</button>
            </>
          )}
        </div>
      ) : (
        <>
          {inauguraciones.length > 0 && (
            <section className="mt-10">
              <h2 className="text-3xl md:text-[41px] font-black tracking-wide text-heading-gray mb-6">{esCL.sectionInauguraciones}</h2>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${isDesktop ? 2 : 1}, minmax(0,1fr))`, gap: isDesktop ? "118px" : "24px" }}>
                {inauguraciones.map((e) => (
                  <InauguracionCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}

          {exposActuales.length > 0 && (
            <section className="mt-16">
              <h2 className="text-3xl md:text-[41px] font-semibold tracking-wide text-heading-gray mb-6">{esCL.sectionExposActuales}</h2>
              <div style={{ display: "grid", gridTemplateColumns: `repeat(${isDesktop ? 3 : 1}, minmax(0,1fr))`, gap: "24px" }}>
                {exposActuales.map((e) => (
                  <ExpoCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <CityCarousel cityCounts={cityCounts} cityNames={cityNames} excludeCityId={cityId} onSelectCity={goToCity} />

      <Footer />

      <CityPickerPanel
        open={locationOpen}
        cityId={cityId}
        cityCounts={cityCounts}
        cityNames={cityNames}
        regions={regions}
        onClose={() => {
          setLocationOpen(false);
          cityPickerTriggerRef.current?.focus();
        }}
        onSelect={selectCity}
      />

      <MenuDrawer
        open={drawerOpen}
        familyMode={familyMode}
        onClose={() => setDrawerOpen(false)}
        onToggleFamilyMode={toggleFamilyMode}
      />
    </div>
  );
}
