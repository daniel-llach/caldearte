"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { esCL } from "@/i18n/es-CL";
import { monthBounds } from "@/lib/date";
import { eventsActiveInRange, filterByCity, filterByPlaceName, searchEvents, type EventRecord } from "@/lib/events";
import { slugify } from "@/lib/cities";
import ExpoCard from "@/components/ExpoCard";
import FilterDrawer, { type ArchiveFilters } from "./FilterDrawer";

interface ArchiveMonthViewProps {
  events: EventRecord[]; // already scoped to this year/month (eventsForMonth)
  year: number;
  month: number;
  prevHref: string | null;
  nextHref: string | null;
}

const SEARCH_DEBOUNCE_MS = 200;

export default function ArchiveMonthView({ events, year, month, prevHref, nextHref }: ArchiveMonthViewProps) {
  const { start: monthStart, end: monthEnd } = useMemo(() => monthBounds(year, month), [year, month]);

  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filters, setFilters] = useState<ArchiveFilters>({ desde: monthStart, hasta: monthEnd, lugar: "", comuna: "" });

  // Instant-echo input, debounced actual filter — same pattern as
  // CityPickerPanel's search box.
  useEffect(() => {
    const timer = setTimeout(() => setFilterQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const comunas = useMemo(() => {
    const names = new Set(events.map((e) => e.regionName).filter((n): n is string => n !== null));
    return [...names].sort((a, b) => a.localeCompare(b, "es"));
  }, [events]);

  const visibleEvents = useMemo(() => {
    let result = searchEvents(events, filterQuery);
    result = eventsActiveInRange(result, filters.desde, filters.hasta);
    result = filterByPlaceName(result, filters.lugar);
    if (filters.comuna) result = filterByCity(result, slugify(filters.comuna));
    return result;
  }, [events, filterQuery, filters]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        {prevHref && (
          <Link href={prevHref} className="text-sm text-muted-gray">
            {esCL.archivePrevMonth}
          </Link>
        )}
        <span className="flex-grow" />
        {nextHref && (
          <Link href={nextHref} className="text-sm text-muted-gray">
            {esCL.archiveNextMonth}
          </Link>
        )}
      </div>

      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={esCL.archiveSearchPlaceholder}
          className="flex-grow text-[15px] px-4 py-3 rounded-xl bg-picker-subtle border border-picker-border text-heading-gray placeholder:text-picker-placeholder focus:outline-none"
        />
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label={esCL.archiveFiltersAriaLabel}
          className="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl bg-picker-subtle border border-picker-border text-heading-gray"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M2 4h14M5 9h8M7.5 14h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <p className="text-sm text-muted-gray mb-4">{esCL.archiveResultsCount(visibleEvents.length)}</p>

      {visibleEvents.length === 0 ? (
        <p className="text-sm text-muted-gray py-10 text-center">{esCL.archiveNoResults}</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "24px" }}>
          {visibleEvents.map((e) => (
            <ExpoCard key={e.id} event={e} />
          ))}
        </div>
      )}

      <FilterDrawer
        open={drawerOpen}
        filters={filters}
        comunas={comunas}
        monthStart={monthStart}
        monthEnd={monthEnd}
        onChange={setFilters}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
