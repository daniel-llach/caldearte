"use client";

import { useState } from "react";
import CardImage from "./CardImage";
import { anchorDateOnly, buildGoogleCalendarUrl, fmtInauguracionDate, fmtOpeningHour, fmtPeriod } from "@/lib/date";
import { deriveComuna } from "@/lib/comuna";
import { esCL } from "@/i18n/es-CL";
import type { EventRecord } from "@/lib/events";

// Google Maps "directions" turn-arrow glyph, not a location pin —
// `color` differs by context: white for the dark card button, dark for
// the light mobile menu row.
function DirectionsGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polyline points="15 14 20 9 15 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Inline "external link" glyph for the mobile menu row — NOT the same
// asset as the desktop icon (/icons/link-affordance.svg), which is
// designed to sit on the card's own dark background; reusing it on the
// light menu background risked an invisible (white-on-white) icon.
function ExternalLinkGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "Add to calendar" glyph (calendar + plus) for the menu row.
function CalendarGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="2" />
      <line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="2" />
      <line x1="8" y1="3" x2="8" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="13" x2="12" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function KebabGlyph() {
  return (
    <svg width="4" height="16" viewBox="0 0 4 16" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="2" cy="2" r="1.7" />
      <circle cx="2" cy="8" r="1.7" />
      <circle cx="2" cy="14" r="1.7" />
    </svg>
  );
}

interface EventCardBaseProps {
  event: EventRecord;
  // "inauguracion": show only the single opening date (+ hour, or a
  // consult-the-venue suggestion when no hour is confirmed) — never the
  // exhibition's full run. "expo": the exhibition's full run range, same
  // as before. Real bug, found 2026-07-20: both used to render the same
  // full-run text, so an inauguración card showed the whole run through
  // closing day instead of just its own opening date.
  variant: "inauguracion" | "expo";
  imageAspectClass: string; // e.g. "aspect-[520/248]"
  venueClass: string;
  titleClass: string;
  periodClass: string;
  contentPaddingClass: string;
}

export default function EventCardBase({
  event,
  variant,
  imageAspectClass,
  venueClass,
  titleClass,
  periodClass,
  contentPaddingClass,
}: EventCardBaseProps) {
  const anchor = anchorDateOnly(event);
  const dateLine =
    variant === "inauguracion" && event.openingDatetime
      ? `${fmtInauguracionDate(event.openingDatetime)} - ${
          event.openingTimeConfirmed ? fmtOpeningHour(event.openingDatetime) : esCL.consultHourWithVenue
        }`
      : // "expo" variant: just the exhibition's run range, never an hour —
        // a specific time only ever means something for an inauguración (a
        // moment to show up), not for browsing an exhibition's run. Real
        // bug, found 2026-07-20: this used to append the same hour suffix
        // as the inauguración variant, so "Expos Actuales" showed things
        // like "9 al 26 de julio - 08:30 hr".
        anchor && fmtPeriod(event.runStartDate, event.runEndDate, anchor);

  const displayedVenue = event.placeName ?? event.freeformLocation;
  const comuna = deriveComuna(event.freeformLocation, event.placeName);
  // Don't repeat the comuna if it's already visible inside the venue text
  // itself (e.g. "MAC Quinta Normal" already says Quinta Normal).
  const comunaAlreadyShown = comuna !== null && displayedVenue.toLowerCase().includes(comuna.toLowerCase());
  const venueLine = comuna && !comunaAlreadyShown ? `${displayedVenue} — ${comuna}` : displayedVenue;

  // "Cómo llegar" — Google Maps DIRECTIONS (not a plain search pin), since
  // that's what a visitor actually wants: a route from wherever they are
  // to the venue. No lat/lng needed — Maps resolves a text address itself,
  // and venueLine (already the most specific string we have: placeName,
  // falling back to freeformLocation, with comuna appended when it isn't
  // already implied) is a good enough query on its own; ", Chile" just
  // disambiguates internationally.
  const mapsQuery = venueLine.trim() ? `${venueLine}, Chile` : null;
  const mapsHref = mapsQuery ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}` : null;

  // "Agregar a mi calendario" — inauguraciones only (expos have no single
  // event moment) and only once a real opening date exists.
  const calendarHref =
    variant === "inauguracion" && event.openingDatetime
      ? buildGoogleCalendarUrl({
          title: event.title,
          openingDatetime: event.openingDatetime,
          openingTimeConfirmed: event.openingTimeConfirmed,
          description: event.description,
          sourceUrl: event.sourceUrl,
          venueLine,
        })
      : null;

  // Both action icons collapse into a single "more options" (kebab)
  // button, opening a small menu with the two destinations, each labeled.
  // Originally mobile-only, but the user liked the collapsed UX enough
  // (2026-07-20) to want it everywhere — no more desktop/mobile split.
  const [menuOpen, setMenuOpen] = useState(false);
  const hasActions = Boolean(mapsHref || event.sourceUrl || calendarHref);

  return (
    <div className="relative bg-black rounded-2xl overflow-hidden flex flex-col h-full">
      <div className={`shrink-0 h-[185.53px] ${imageAspectClass}`}>
        <CardImage imageUrl={event.imageUrl} sourceUrl={event.sourceUrl} sensitivityTags={event.sensitivityTags} />
      </div>
      <div className={`flex flex-col gap-1.5 ${contentPaddingClass}`}>
        <p className={`${venueClass} text-venue-gray truncate`}>{venueLine}</p>
        <p className={`${titleClass} text-white`}>{event.title}</p>
        {dateLine && <p className={`${periodClass} text-period-gray`}>{dateLine}</p>}
      </div>

      {/* A single kebab button opens a small menu with both destinations,
          each with an icon + label — same collapsed treatment on every
          screen size (originally mobile-only, promoted to desktop too on
          2026-07-20 per explicit feedback: "me encanto el menu kebab lo
          quiero para desktop tambien"). */}
      {hasActions && (
        <div className="absolute bottom-3 right-3">
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label={esCL.cardMoreOptionsAriaLabel}
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
              />
              <div role="menu" className="absolute bottom-10 right-0 z-20 min-w-[190px] overflow-hidden rounded-xl bg-white shadow-lg py-1">
                {mapsHref && (
                  <a
                    href={mapsHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                    onClick={() => setMenuOpen(false)}
                  >
                    <DirectionsGlyph color="black" />
                    {esCL.cardMenuDirections}
                  </a>
                )}
                {event.sourceUrl && (
                  <a
                    href={event.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                    onClick={() => setMenuOpen(false)}
                  >
                    <ExternalLinkGlyph color="black" />
                    {esCL.cardMenuSource}
                  </a>
                )}
                {calendarHref && (
                  <a
                    href={calendarHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    role="menuitem"
                    className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                    onClick={() => setMenuOpen(false)}
                  >
                    <CalendarGlyph color="black" />
                    {esCL.cardMenuAddToCalendar}
                  </a>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-label={esCL.cardMoreOptionsAriaLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="relative z-20 w-8 h-8 rounded-full border border-white/70 flex items-center justify-center"
          >
            <KebabGlyph />
          </button>
        </div>
      )}
    </div>
  );
}
