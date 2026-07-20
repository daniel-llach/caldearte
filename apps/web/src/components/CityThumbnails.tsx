import { resolveCardImage, PLACEHOLDER_BG } from "@/lib/image-source";
import type { EventRecord } from "@/lib/events";

// Small, non-interactive preview strip for the "Arte en todas partes"
// carousel — deliberately NOT a reuse of CardImage.tsx, which has its own
// "revelar contenido sensible" button; nesting a button inside the city
// card (itself a button) would break accessibility. A sensitivity-tagged
// event's thumbnail is permanently blurred instead, no reveal option —
// this is a decorative preview, not the event's own primary content.
export default function CityThumbnails({ events }: { events: EventRecord[] }) {
  if (events.length === 0) return null;

  return (
    <div className="flex gap-1.5">
      {events.map((e) => {
        const image = resolveCardImage(e);
        const sensitive = e.sensitivityTags.length > 0;
        return (
          <div key={e.id} className="w-10 h-10 rounded-lg overflow-hidden bg-stone-800 shrink-0">
            {image.type === "photo" ? (
              // eslint-disable-next-line @next/next/no-img-element -- external, unoptimized scraped URLs, see next.config.ts
              <img src={image.url} alt="" className={`w-full h-full object-cover ${sensitive ? "blur-md scale-110" : ""}`} />
            ) : (
              <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${PLACEHOLDER_BG[image.source]})` }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
