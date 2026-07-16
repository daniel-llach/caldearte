import CardImage from "./CardImage";
import { anchorDateOnly, fmtOpeningHour, fmtPeriod } from "@/lib/date";
import { deriveComuna } from "@/lib/comuna";
import type { EventRecord } from "@/lib/events";

interface EventCardBaseProps {
  event: EventRecord;
  imageAspectClass: string; // e.g. "aspect-[520/248]"
  venueClass: string;
  titleClass: string;
  periodClass: string;
  contentPaddingClass: string;
}

export default function EventCardBase({
  event,
  imageAspectClass,
  venueClass,
  titleClass,
  periodClass,
  contentPaddingClass,
}: EventCardBaseProps) {
  const anchor = anchorDateOnly(event);
  const period = anchor ? fmtPeriod(event.runStartDate, event.runEndDate, anchor) : null;
  const hourSuffix = event.openingDatetime ? ` - ${fmtOpeningHour(event.openingDatetime)}` : "";

  const displayedVenue = event.placeName ?? event.freeformLocation;
  const comuna = deriveComuna(event.freeformLocation, event.placeName);
  // Don't repeat the comuna if it's already visible inside the venue text
  // itself (e.g. "MAC Quinta Normal" already says Quinta Normal).
  const comunaAlreadyShown = comuna !== null && displayedVenue.toLowerCase().includes(comuna.toLowerCase());
  const venueLine = comuna && !comunaAlreadyShown ? `${displayedVenue} — ${comuna}` : displayedVenue;

  return (
    <div className="relative bg-black rounded-2xl overflow-hidden flex flex-col h-full">
      <div className={`shrink-0 h-[185.53px] ${imageAspectClass}`}>
        <CardImage imageUrl={event.imageUrl} sourceUrl={event.sourceUrl} sensitivityTags={event.sensitivityTags} />
      </div>
      <div className={`flex flex-col gap-1.5 ${contentPaddingClass}`}>
        <p className={`${venueClass} text-venue-gray truncate`}>{venueLine}</p>
        <p className={`${titleClass} text-white`}>{event.title}</p>
        {period && (
          <p className={`${periodClass} text-period-gray`}>
            {period}
            {hourSuffix}
          </p>
        )}
      </div>

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
