"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { esCL } from "@/i18n/es-CL";
import { searchEvents, type EventRecord } from "@/lib/events";
import InauguracionCard from "./InauguracionCard";
import ExpoCard from "./ExpoCard";

interface SearchPanelProps {
  open: boolean;
  // Every active/upcoming, family-mode-filtered event across every comuna —
  // deliberately NOT scoped to the currently selected city/día-semana
  // window (see the product discussion: a scoped-empty result is
  // ambiguous — "doesn't exist" vs. "wrong filter"). Never includes past
  // (archived) events; that stays the Archive's own job.
  events: EventRecord[];
  onClose: () => void;
}

function SearchGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

const SEARCH_DEBOUNCE_MS = 200;

// Full-screen modal, same chrome/behavior as CityPickerPanel (open/close
// transition, inert while closed, body-scroll lock, focus-on-open,
// Escape-to-close) — independent of it and of MenuDrawer, its own panel per
// the product decision.
export default function SearchPanel({ open, events, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Same render-time reset pattern as CityPickerPanel: clears the query the
  // moment the panel transitions to open, not via an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setQuery("");
      setFilterQuery("");
    }
  }

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

  useEffect(() => {
    const timer = setTimeout(() => setFilterQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const trimmedQuery = filterQuery.trim();
  const results = trimmedQuery ? searchEvents(events, trimmedQuery) : [];

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={esCL.searchTitle}
      inert={!open}
      className={`fixed inset-0 z-40 bg-white flex flex-col transition-opacity duration-150 ${
        open ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <div className="relative shrink-0 pt-12 pb-5 px-4">
        <button onClick={onClose} aria-label={esCL.closeSearch} className="absolute top-6 right-6 text-[18px] text-muted-gray">
          ✕
        </button>
        <div className="max-w-[680px] mx-auto mb-6">
          <h2 className="text-[24px] md:text-[32px] font-bold text-heading-gray">{esCL.searchTitle}</h2>
        </div>
        <div className="max-w-[680px] mx-auto relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-picker-placeholder">
            <SearchGlyph />
          </span>
          <input
            ref={inputRef}
            type="text"
            role="searchbox"
            aria-label={esCL.searchAriaLabel}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={esCL.searchPlaceholder}
            className="w-full text-[15px] pl-11 pr-4 py-3 rounded-xl bg-picker-subtle border border-picker-border text-heading-gray placeholder:text-picker-placeholder focus:outline-none"
          />
        </div>
      </div>

      <div className="flex-grow overflow-y-auto px-4 pb-10">
        <div className="max-w-[900px] mx-auto">
          {!trimmedQuery ? (
            <p className="text-sm text-muted-gray text-center py-10">{esCL.searchHint}</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-gray text-center py-10">{esCL.noSearchResults}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {results.map((e) => (e.openingDatetime ? <InauguracionCard key={e.id} event={e} /> : <ExpoCard key={e.id} event={e} />))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
