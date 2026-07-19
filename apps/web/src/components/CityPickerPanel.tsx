"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { esCL } from "@/i18n/es-CL";
import {
  buildRegionMetaByCityId,
  citiesWithEvents,
  groupCitiesByRegion,
  matchesQuery,
  type AdminRegionGroup,
  type City,
  type CountryGroup,
} from "@/lib/cities";
import { sumCounts, type CityCounts, type RegionMeta, type WindowMode } from "@/lib/events";

interface CityPickerPanelProps {
  open: boolean;
  cityId: string; // the CONFIRMED city — seeds pendingCityId whenever the panel opens
  cityCountsDay: Record<string, CityCounts>;
  cityCountsWeek: Record<string, CityCounts>;
  cityNames: Record<string, string>;
  regions: RegionMeta[];
  windowMode: WindowMode; // the CONFIRMED mode — seeds pendingWindowMode whenever the panel opens
  onClose: () => void;
  onExplore: (cityId: string, windowMode: WindowMode) => void;
}

// Purely local selection — does NOT close the panel or touch cookies.
// Both this and picking a city are "pending" until Explorar commits them
// together; closing via the X/Escape discards whatever was picked here.
function WindowModeToggle({ mode, onSelect }: { mode: WindowMode; onSelect: (mode: WindowMode) => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        onClick={() => onSelect("day")}
        className={`text-sm rounded-full px-4 py-1.5 transition-colors ${
          mode === "day" ? "bg-heading-gray text-white" : "bg-picker-subtle text-muted-gray"
        }`}
      >
        {esCL.windowModeDay}
      </button>
      <button
        onClick={() => onSelect("week")}
        className={`text-sm rounded-full px-4 py-1.5 transition-colors ${
          mode === "week" ? "bg-heading-gray text-white" : "bg-picker-subtle text-muted-gray"
        }`}
      >
        {esCL.windowModeWeek}
      </button>
    </div>
  );
}

const ZERO_COUNTS: CityCounts = { inauguraciones: 0, exposActuales: 0 };
const SEARCH_DEBOUNCE_MS = 200;

function countsFor(cities: City[], cityCounts: Record<string, CityCounts>): CityCounts {
  return sumCounts(cities.map((c) => cityCounts[c.id] ?? ZERO_COUNTS));
}

// Regions are grouped first by país (see cities.ts), so a región's key
// needs the país in it too — otherwise a same-named región in a future
// second country would collide with Chile's.
function regionKey(country: string, adminRegionName: string): string {
  return `${country}::${adminRegionName}`;
}

function cityOptionId(cityId: string): string {
  return `city-option-${cityId}`;
}

function regionOptionId(key: string): string {
  return `region-option-${key}`;
}

type NavEntry = { type: "region"; key: string } | { type: "city"; city: City };

interface CityRowProps {
  city: City;
  counts: CityCounts;
  selected: boolean;
  active: boolean;
  onSelect: (city: City) => void;
  onHover: () => void;
}

function CityRow({ city, counts, selected, active, onSelect, onHover }: CityRowProps) {
  return (
    <button
      id={cityOptionId(city.id)}
      role="option"
      aria-selected={selected}
      ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
      onClick={() => onSelect(city)}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-2 pl-[52px] pr-3 py-2.5 rounded-lg text-left transition-colors ${
        selected ? "bg-heading-gray" : active ? "bg-stone-100" : "hover:bg-stone-50"
      }`}
    >
      <span className={`flex-grow text-sm ${selected ? "font-semibold text-white" : "text-heading-gray"}`}>{city.name}</span>
      {counts.exposActuales > 0 && (
        <span
          className={`text-[11px] font-medium rounded px-2 py-0.5 shrink-0 ${
            selected ? "bg-white/15 text-white" : "bg-picker-subtle text-muted-gray"
          }`}
        >
          {counts.exposActuales} expos
        </span>
      )}
      {counts.inauguraciones > 0 && (
        <span
          className={`text-[11px] font-medium rounded px-2 py-0.5 shrink-0 ${
            selected ? "bg-white/15 text-white" : "bg-picker-badge-inaug-bg text-picker-badge-inaug-fg"
          }`}
        >
          {counts.inauguraciones} inaug
        </span>
      )}
    </button>
  );
}

interface RegionRowProps {
  region: AdminRegionGroup;
  navKey: string;
  expanded: boolean;
  active: boolean;
  totalCount: number;
  onToggle: () => void;
  onHover: () => void;
}

function RegionRow({ region, navKey, expanded, active, totalCount, onToggle, onHover }: RegionRowProps) {
  return (
    <button
      id={regionOptionId(navKey)}
      aria-expanded={expanded}
      ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
      onClick={onToggle}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-2.5 px-3 py-3.5 text-left rounded-lg transition-colors ${
        active ? "bg-stone-100" : "hover:bg-stone-50"
      }`}
    >
      <span className="text-[11px] text-picker-placeholder w-3 shrink-0">{expanded ? "▾" : "▸"}</span>
      {region.adminRegionNumeral && (
        <span className="text-[10px] font-semibold text-muted-gray bg-picker-subtle rounded px-1.5 py-0.5 shrink-0">
          {region.adminRegionNumeral}
        </span>
      )}
      <span className="flex-grow text-sm font-medium text-heading-gray">{region.adminRegionName}</span>
      <span className="text-[13px] text-picker-placeholder">{totalCount}</span>
    </button>
  );
}

export default function CityPickerPanel({
  open,
  cityId,
  cityCountsDay,
  cityCountsWeek,
  cityNames,
  regions,
  windowMode,
  onClose,
  onExplore,
}: CityPickerPanelProps) {
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());
  const [pendingCityId, setPendingCityId] = useState(cityId);
  const [pendingWindowMode, setPendingWindowMode] = useState(windowMode);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const exploreButtonRef = useRef<HTMLButtonElement>(null);

  const metaByCityId = useMemo(() => buildRegionMetaByCityId(regions), [regions]);
  const cityCounts = pendingWindowMode === "day" ? cityCountsDay : cityCountsWeek;

  // Reset search + expand state + pending picks whenever the modal
  // transitions to open — computed during render (React's documented
  // pattern for resetting state in response to a prop change), not inside
  // an effect, which would cause an extra cascading render. The
  // currently-CONFIRMED comuna's región starts expanded, everything else
  // starts collapsed; pendingCityId/pendingWindowMode reset to whatever is
  // currently confirmed, discarding any unconfirmed pick from a prior
  // open-then-closed-via-X session.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setFilterQuery("");
      setActiveIndex(0);
      setPendingCityId(cityId);
      setPendingWindowMode(windowMode);
      const selectedMeta = metaByCityId.get(cityId);
      setExpandedRegions(
        selectedMeta?.adminRegionName ? new Set([regionKey(selectedMeta.country, selectedMeta.adminRegionName)]) : new Set(),
      );
    }
  }

  // Focusing the DOM input and locking body scroll are real
  // external-system side effects, so they stay in effects (unlike the
  // state resets above).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  // Debounced filter: `query` echoes the input instantly (so typing feels
  // immediate), `filterQuery` — what actually drives filtering below —
  // lags 200ms behind the last keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setFilterQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // "Muestra lo que hay", same as before — only comunas with events, plus
  // the pending pick so it never vanishes mid-selection (e.g. it has
  // events in Semanal but not Día, and the user is still toggling around).
  const allCities = useMemo(
    () => citiesWithEvents(cityCounts, cityNames, { alwaysIncludeCityId: pendingCityId }),
    [cityCounts, cityNames, pendingCityId],
  );

  const trimmedQuery = filterQuery.trim();
  const isSearching = trimmedQuery !== "";

  const filteredCities = useMemo(() => {
    if (!trimmedQuery) return allCities;
    return allCities.filter((c) => {
      if (matchesQuery(c.name, trimmedQuery)) return true;
      const adminRegionName = metaByCityId.get(c.id)?.adminRegionName;
      return adminRegionName ? matchesQuery(adminRegionName, trimmedQuery) : false;
    });
  }, [allCities, trimmedQuery, metaByCityId]);

  // A región/país only appears here if it has at least one comuna left
  // after the events + search filters above — no separate pass needed.
  const groups: CountryGroup[] = useMemo(() => groupCitiesByRegion(filteredCities, metaByCityId), [filteredCities, metaByCityId]);

  // While actively searching, every región left standing (i.e. containing
  // a match) shows fully expanded regardless of manual toggle state — "si
  // el texto matchea una comuna, mostrar la comuna y su región
  // (expandida)". Clearing the search reverts to whatever the user
  // manually toggled.
  function isRegionExpanded(key: string): boolean {
    return isSearching || expandedRegions.has(key);
  }

  // One flat, display-order list — región rows interleaved with their
  // comunas only when expanded — drives keyboard navigation regardless of
  // how many regions/comunas are actually visible right now.
  const navEntries = useMemo(() => {
    const entries: NavEntry[] = [];
    for (const group of groups) {
      for (const region of group.regions) {
        const key = regionKey(group.country, region.adminRegionName);
        entries.push({ type: "region", key });
        if (isSearching || expandedRegions.has(key)) {
          for (const city of region.cities) entries.push({ type: "city", city });
        }
      }
      for (const city of group.ungrouped) entries.push({ type: "city", city });
    }
    return entries;
  }, [groups, expandedRegions, isSearching]);

  const navIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    navEntries.forEach((entry, i) => map.set(entry.type === "region" ? `region:${entry.key}` : `city:${entry.city.id}`, i));
    return map;
  }, [navEntries]);

  // Same render-time reset pattern as the open-transition above: a new
  // (debounced) query means a new result set, so the highlighted row
  // snaps back to the top of it.
  const [prevFilterQuery, setPrevFilterQuery] = useState(filterQuery);
  if (filterQuery !== prevFilterQuery) {
    setPrevFilterQuery(filterQuery);
    setActiveIndex(0);
  }

  const activeEntry = navEntries[activeIndex];

  function toggleRegion(key: string) {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, navEntries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!activeEntry) return;
      // Marks the pick as pending only — never closes the panel. Only
      // Explorar (button, or Enter while it's focused) commits.
      if (activeEntry.type === "region") toggleRegion(activeEntry.key);
      else setPendingCityId(activeEntry.city.id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      // Lightweight focus trap: three real DOM tab stops (input, Explorar,
      // close button) — every región/comuna row is virtually highlighted
      // via aria-activedescendant, never actually DOM-focused, same
      // combobox pattern as the arrow-key navigation above.
      e.preventDefault();
      exploreButtonRef.current?.focus();
    }
  }

  function handleExploreKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) inputRef.current?.focus();
      else closeButtonRef.current?.focus();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  function handleCloseKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      if (e.shiftKey) exploreButtonRef.current?.focus();
      else inputRef.current?.focus();
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  const activeDescendantId = activeEntry
    ? activeEntry.type === "region"
      ? regionOptionId(activeEntry.key)
      : cityOptionId(activeEntry.city.id)
    : undefined;

  const hasAnyCityResult = navEntries.some((e) => e.type === "city");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={esCL.cityPickerAriaLabel}
      // `inert` (not just visual hiding) pulls the whole modal out of the
      // tab order and accessibility tree while closed — it's always
      // mounted (so the opacity transition can play), but a closed modal
      // must never be reachable by Tab or a screen reader.
      inert={!open}
      className={`fixed inset-0 z-40 bg-white flex flex-col transition-opacity duration-150 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="relative shrink-0 pt-12 pb-5 px-4">
        <button
          ref={closeButtonRef}
          onClick={onClose}
          onKeyDown={handleCloseKeyDown}
          aria-label={esCL.closeCityPicker}
          className="absolute top-6 right-6 text-[18px] text-muted-gray"
        >
          ✕
        </button>
        <div className="max-w-[680px] mx-auto flex items-center justify-between gap-4 mb-6">
          <h2 className="text-[24px] md:text-[32px] font-bold text-heading-gray">{esCL.chooseCity}</h2>
          <WindowModeToggle mode={pendingWindowMode} onSelect={setPendingWindowMode} />
        </div>
        <div className="max-w-[680px] mx-auto">
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={esCL.citySearchAriaLabel}
            aria-controls="city-picker-listbox"
            aria-activedescendant={activeDescendantId}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={esCL.citySearchPlaceholder}
            className="w-full text-[15px] px-4 py-3 rounded-xl bg-picker-subtle border border-picker-border text-heading-gray placeholder:text-picker-placeholder focus:outline-none"
          />
        </div>
      </div>

      <div id="city-picker-listbox" role="listbox" aria-label={esCL.chooseCity} className="flex-grow overflow-y-auto px-4 pb-10">
        <div className="max-w-[680px] mx-auto">
          {!hasAnyCityResult ? (
            <p className="text-sm text-muted-gray text-center py-10">{esCL.noCityResults}</p>
          ) : (
            groups.map((group) => {
              const countryCities = [...group.regions.flatMap((r) => r.cities), ...group.ungrouped];
              const countryCounts = countsFor(countryCities, cityCounts);
              const countryPhrase = esCL.cityStats(countryCounts.inauguraciones, countryCounts.exposActuales);
              return (
                <div key={group.country}>
                  <div className="flex items-center justify-between py-2 border-b border-picker-border/60">
                    <span className="text-sm font-semibold text-heading-gray">{group.country}</span>
                    {countryPhrase && <span className="text-[13px] text-muted-gray">{countryPhrase}</span>}
                  </div>
                  {group.regions.map((region) => {
                    const key = regionKey(group.country, region.adminRegionName);
                    const expanded = isRegionExpanded(key);
                    const total = countsFor(region.cities, cityCounts);
                    return (
                      <div key={key} className="border-b border-picker-border/30">
                        <RegionRow
                          region={region}
                          navKey={key}
                          expanded={expanded}
                          active={activeEntry?.type === "region" && activeEntry.key === key}
                          totalCount={total.inauguraciones + total.exposActuales}
                          onToggle={() => toggleRegion(key)}
                          onHover={() => setActiveIndex(navIndexByKey.get(`region:${key}`) ?? 0)}
                        />
                        {expanded && (
                          <div role="listbox" aria-labelledby={regionOptionId(key)}>
                            {region.cities.map((city) => (
                              <CityRow
                                key={city.id}
                                city={city}
                                counts={cityCounts[city.id] ?? ZERO_COUNTS}
                                selected={city.id === pendingCityId}
                                active={activeEntry?.type === "city" && activeEntry.city.id === city.id}
                                onSelect={(c) => setPendingCityId(c.id)}
                                onHover={() => setActiveIndex(navIndexByKey.get(`city:${city.id}`) ?? 0)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {group.ungrouped.length > 0 && (
                    <div>
                      {group.ungrouped.map((city) => (
                        <CityRow
                          key={city.id}
                          city={city}
                          counts={cityCounts[city.id] ?? ZERO_COUNTS}
                          selected={city.id === pendingCityId}
                          active={activeEntry?.type === "city" && activeEntry.city.id === city.id}
                          onSelect={(c) => setPendingCityId(c.id)}
                          onHover={() => setActiveIndex(navIndexByKey.get(`city:${city.id}`) ?? 0)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-picker-border px-6 pt-3.5 pb-4 flex items-center justify-between gap-4">
        <div className="hidden md:flex items-center gap-6 text-[11px] text-picker-placeholder">
          <span>{esCL.cityPickerHints.navigate}</span>
          <span>{esCL.cityPickerHints.select}</span>
          <span>{esCL.cityPickerHints.close}</span>
        </div>
        <button
          ref={exploreButtonRef}
          onClick={() => onExplore(pendingCityId, pendingWindowMode)}
          onKeyDown={handleExploreKeyDown}
          className="ml-auto inline-flex items-center gap-2 bg-heading-gray text-white rounded-lg px-5 py-2.5 text-sm font-semibold"
        >
          {esCL.explorar} →
        </button>
      </div>
    </div>
  );
}
