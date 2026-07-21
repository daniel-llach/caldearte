"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { esCL } from "@/i18n/es-CL";
import { cityById } from "@/lib/cities";
import { CITY_COOKIE, FAMILY_MODE_COOKIE, WINDOW_MODE_COOKIE } from "@/lib/cookies";
import { fmtShort } from "@/lib/date";
import type { CityCounts, EventRecord, RegionMeta, WindowMode } from "@/lib/events";
import Header from "./Header";
import InauguracionCard from "./InauguracionCard";
import ExpoCard from "./ExpoCard";
import CityCarousel from "./CityCarousel";
import Footer from "./Footer";
import CityPickerPanel from "./CityPickerPanel";
import MenuDrawer from "./MenuDrawer";
import SearchPanel from "./SearchPanel";

interface CalendarViewProps {
  inauguraciones: EventRecord[];
  exposActuales: EventRecord[];
  cityId: string;
  cityNames: Record<string, string>; // real observed comuna names, id -> name — see cities.ts
  familyMode: boolean;
  today: string; // YYYY-MM-DD, computed server-side for SSR/CSR consistency
  windowMode: WindowMode;
  rangeStart: string; // YYYY-MM-DD — today in Día mode, the week's Monday in Semana mode
  rangeEnd: string; // YYYY-MM-DD — today in Día mode, the week's Sunday in Semana mode
  cityCounts: Record<string, CityCounts>; // the CONFIRMED window's counts — CityCarousel/Header
  cityCountsDay: Record<string, CityCounts>; // both variants, for the picker's live Hoy/Semanal preview
  cityCountsWeek: Record<string, CityCounts>;
  cityThumbnails: Record<string, EventRecord[]>; // up to 4 preview events per comuna — CityCarousel
  searchableEvents: EventRecord[]; // active/upcoming, every comuna — SearchPanel's own scope
  nextEvent: EventRecord | null; // empty-state fallback, beyond "today"
  regions: RegionMeta[]; // for the city picker's región grouping
  archiveHref: string | null; // "Expos anteriores" row target in MenuDrawer — null when no month is archived yet
}

function setCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${60 * 60 * 24 * 365}`;
}

export default function CalendarView({
  inauguraciones,
  exposActuales,
  cityId,
  cityNames,
  familyMode,
  today,
  windowMode,
  rangeStart,
  rangeEnd,
  cityCounts,
  cityCountsDay,
  cityCountsWeek,
  cityThumbnails,
  searchableEvents,
  nextEvent,
  regions,
  archiveHref,
}: CalendarViewProps) {
  const router = useRouter();
  const cityPickerTriggerRef = useRef<HTMLButtonElement>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const city = cityById(cityId, cityNames);

  function goToCity(nextCityId: string) {
    setCookie(CITY_COOKIE, nextCityId);
    setLocationOpen(false);
    window.scrollTo(0, 0);
    router.refresh();
  }

  function toggleFamilyMode() {
    setCookie(FAMILY_MODE_COOKIE, familyMode ? "" : "1");
    router.refresh();
  }

  // Only the picker's "Explorar" button reaches this — picking a city or
  // toggling Hoy/Semanal inside the panel is purely local/pending state
  // until then (see CityPickerPanel). Closing via the X or Escape calls
  // onClose only, never this — so unconfirmed picks are simply discarded.
  function explore(nextCityId: string, nextWindowMode: WindowMode) {
    setCookie(CITY_COOKIE, nextCityId);
    setCookie(WINDOW_MODE_COOKIE, nextWindowMode);
    setLocationOpen(false);
    window.scrollTo(0, 0);
    router.refresh();
  }

  const isEmpty = inauguraciones.length === 0 && exposActuales.length === 0;

  return (
    <div className="w-full relative">
      <Header
        city={city}
        familyMode={familyMode}
        today={today}
        windowMode={windowMode}
        rangeStart={rangeStart}
        rangeEnd={rangeEnd}
        inauguracionesCount={inauguraciones.length}
        exposCount={exposActuales.length}
        onOpenCityPicker={() => setLocationOpen(true)}
        cityPickerTriggerRef={cityPickerTriggerRef}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenMenu={() => setDrawerOpen(true)}
        onToggleFamilyMode={toggleFamilyMode}
      />

      {isEmpty ? (
        <div className="py-10">
          {nextEvent ? (
            <p className="text-sm text-heading-gray">
              {esCL.emptyWithNextEvent(
                city.name,
                windowMode === "day" ? esCL.todaySuffix : esCL.thisWeekSuffix,
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-[118px]">
                {inauguraciones.map((e) => (
                  <InauguracionCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}

          {exposActuales.length > 0 && (
            <section className="mt-16">
              <h2 className="text-3xl md:text-[41px] font-semibold tracking-wide text-heading-gray mb-6">{esCL.sectionExposActuales}</h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {exposActuales.map((e) => (
                  <ExpoCard key={e.id} event={e} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <CityCarousel
        cityCounts={cityCounts}
        cityNames={cityNames}
        cityThumbnails={cityThumbnails}
        regions={regions}
        excludeCityId={cityId}
        onSelectCity={goToCity}
      />

      <Footer />

      <CityPickerPanel
        open={locationOpen}
        cityId={cityId}
        cityCountsDay={cityCountsDay}
        cityCountsWeek={cityCountsWeek}
        cityNames={cityNames}
        regions={regions}
        windowMode={windowMode}
        onClose={() => {
          setLocationOpen(false);
          cityPickerTriggerRef.current?.focus();
        }}
        onExplore={explore}
      />

      <MenuDrawer
        open={drawerOpen}
        familyMode={familyMode}
        archiveHref={archiveHref}
        onClose={() => setDrawerOpen(false)}
        onToggleFamilyMode={toggleFamilyMode}
      />

      <SearchPanel open={searchOpen} events={searchableEvents} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
