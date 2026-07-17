"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { esCL } from "@/i18n/es-CL";
import { buildRegionMetaByCityId, citiesWithEvents, groupCitiesByRegion, matchesQuery, type City } from "@/lib/cities";
import { sumCounts, type CityCounts, type RegionMeta } from "@/lib/events";

interface CityPickerPanelProps {
  open: boolean;
  cityId: string;
  cityCounts: Record<string, CityCounts>;
  cityNames: Record<string, string>;
  regions: RegionMeta[];
  onClose: () => void;
  onSelect: (city: City) => void;
}

const ZERO_COUNTS: CityCounts = { inauguraciones: 0, exposActuales: 0 };

function phraseFor(cities: City[], cityCounts: Record<string, CityCounts>): string {
  const { inauguraciones, exposActuales } = sumCounts(cities.map((c) => cityCounts[c.id] ?? ZERO_COUNTS));
  return esCL.cityStats(inauguraciones, exposActuales);
}

function optionId(cityId: string): string {
  return `city-option-${cityId}`;
}

interface CityOptionProps {
  city: City;
  selected: boolean;
  active: boolean;
  onSelect: (city: City) => void;
  onHover: (city: City) => void;
}

function CityOption({ city, selected, active, onSelect, onHover }: CityOptionProps) {
  return (
    <button
      id={optionId(city.id)}
      role="option"
      aria-selected={selected}
      ref={active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
      onClick={() => onSelect(city)}
      onMouseEnter={() => onHover(city)}
      className={`w-full text-left text-sm px-3 py-2.5 rounded-lg mb-1 transition-colors ${
        selected ? "bg-city-pill-bg text-city-pill-fg" : active ? "bg-stone-100 text-heading-gray" : "text-heading-gray hover:bg-stone-100"
      }`}
    >
      {city.name}
    </button>
  );
}

export default function CityPickerPanel({ open, cityId, cityCounts, cityNames, regions, onClose, onSelect }: CityPickerPanelProps) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset the search/highlight state whenever the panel transitions to
  // open — computed during render (React's documented pattern for
  // resetting state in response to a prop change), not inside an effect,
  // which would cause an extra cascading render.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setActiveIndex(0);
    }
  }

  // Focusing the DOM input is a real external-system side effect, so it
  // stays in an effect (unlike the state resets above).
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const metaByCityId = useMemo(() => buildRegionMetaByCityId(regions), [regions]);

  // "Muestra lo que hay", same as before — only comunas with events, plus
  // the currently-selected one so opening the picker never makes your own
  // (possibly zero-count) city vanish.
  const allCities = useMemo(() => citiesWithEvents(cityCounts, cityNames, { alwaysIncludeCityId: cityId }), [cityCounts, cityNames, cityId]);

  const filteredCities = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return allCities;
    return allCities.filter((c) => {
      if (matchesQuery(c.name, trimmed)) return true;
      const adminRegionName = metaByCityId.get(c.id)?.adminRegionName;
      return adminRegionName ? matchesQuery(adminRegionName, trimmed) : false;
    });
  }, [allCities, query, metaByCityId]);

  // A región/país only appears here if it has at least one comuna left
  // after the events + search filters above — no separate pass needed.
  const groups = useMemo(() => groupCitiesByRegion(filteredCities, metaByCityId), [filteredCities, metaByCityId]);

  // One flat, display-order list drives keyboard navigation regardless of
  // how many país/región headers sit in between.
  const flatCities = useMemo(() => groups.flatMap((g) => [...g.regions.flatMap((r) => r.cities), ...g.ungrouped]), [groups]);
  const indexByCityId = useMemo(() => new Map(flatCities.map((c, i) => [c.id, i])), [flatCities]);

  // Same render-time reset pattern as the open-transition above: a new
  // query means a new result set, so the highlighted option snaps back
  // to the top of it.
  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setActiveIndex(0);
  }

  const activeCity = flatCities[activeIndex];

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, flatCities.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeCity) onSelect(activeCity);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  function renderOption(city: City) {
    return (
      <CityOption
        key={city.id}
        city={city}
        selected={city.id === cityId}
        active={indexByCityId.get(city.id) === activeIndex}
        onSelect={onSelect}
        onHover={(c) => setActiveIndex(indexByCityId.get(c.id) ?? 0)}
      />
    );
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

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={esCL.citySearchPlaceholder}
          role="combobox"
          aria-expanded={open}
          aria-controls="city-picker-listbox"
          aria-autocomplete="list"
          aria-activedescendant={activeCity ? optionId(activeCity.id) : undefined}
          aria-label={esCL.chooseCity}
          className="w-full text-sm px-3 py-2 mb-3 rounded-lg border border-stone-300 text-heading-gray focus:outline-none focus:border-city-pill-bg"
        />

        <div id="city-picker-listbox" role="listbox" aria-label={esCL.chooseCity} className="max-h-[70vh] overflow-y-auto">
          {flatCities.length === 0 ? (
            <p className="text-sm text-muted-gray px-3 py-2.5">{esCL.noCityResults}</p>
          ) : (
            groups.map((group) => {
              const countryCities = [...group.regions.flatMap((r) => r.cities), ...group.ungrouped];
              const countryPhrase = phraseFor(countryCities, cityCounts);
              return (
                <div key={group.country}>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-gray px-3 pt-2 pb-1 sticky top-0 bg-white">
                    {group.country}
                    {countryPhrase ? ` · ${countryPhrase}` : ""}
                  </p>
                  {group.regions.map((region) => {
                    const headingId = `region-heading-${group.country}-${region.adminRegionName}`;
                    const regionPhrase = phraseFor(region.cities, cityCounts);
                    return (
                      <div key={region.adminRegionName} role="group" aria-labelledby={headingId}>
                        <p id={headingId} className="text-xs font-semibold text-muted-gray px-3 pt-2 pb-1 sticky top-6 bg-white">
                          {region.adminRegionName}
                          {regionPhrase ? ` · ${regionPhrase}` : ""}
                        </p>
                        {region.cities.map(renderOption)}
                      </div>
                    );
                  })}
                  {group.ungrouped.length > 0 && (
                    <div role="group" aria-label={group.country}>
                      {group.ungrouped.map(renderOption)}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
