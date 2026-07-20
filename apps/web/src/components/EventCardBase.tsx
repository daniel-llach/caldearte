import CardImage from "./CardImage";
import { anchorDateOnly, fmtInauguracionDate, fmtOpeningHour, fmtPeriod } from "@/lib/date";
import { deriveComuna } from "@/lib/comuna";
import { esCL } from "@/i18n/es-CL";
import type { EventRecord } from "@/lib/events";

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

  return (
    <div className="relative bg-black rounded-2xl overflow-hidden flex flex-col h-full">
      <div className={`shrink-0 h-[185.53px] ${imageAspectClass}`}>
        <CardImage imageUrl={event.imageUrl} sourceUrl={event.sourceUrl} sensitivityTags={event.sensitivityTags} />
      </div>
      <div className={`flex flex-col gap-1.5 ${contentPaddingClass}`}>
        <p className={`${venueClass} text-venue-gray truncate`}>{venueLine}</p>
        <p className={`${titleClass} text-white`}>{event.title}</p>
        {dateLine && <p className={`${periodClass} text-period-gray ${mapsHref ? "pl-9" : ""}`}>{dateLine}</p>}
      </div>

      {mapsHref && (
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 left-3 w-8 h-8 rounded-full border border-white/70 flex items-center justify-center"
          aria-label={esCL.directionsAriaLabel(venueLine)}
        >
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path
              d="M9 1.5c-2.9 0-5.25 2.29-5.25 5.11C3.75 10.5 9 16.5 9 16.5s5.25-6 5.25-9.89C14.25 3.79 11.9 1.5 9 1.5Z"
              stroke="white"
              strokeWidth="1.3"
              strokeLinejoin="round"
            />
            <circle cx="9" cy="6.75" r="1.75" stroke="white" strokeWidth="1.3" />
          </svg>
        </a>
      )}

      {event.sourceUrl && (
        <a
          href={event.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-3 right-3 w-8 h-8"
          aria-label={event.title}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- provided icon asset, verbatim per design decision */}
          <img src="/icons/link-affordance.svg" alt="" className="w-8 h-8" />
        </a>
      )}
    </div>
  );
}
