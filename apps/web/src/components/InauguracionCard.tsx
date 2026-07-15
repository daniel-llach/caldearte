import EventCardBase from "./EventCardBase";
import type { EventRecord } from "@/lib/events";

export default function InauguracionCard({ event }: { event: EventRecord }) {
  return (
    <EventCardBase
      event={event}
      imageAspectClass="aspect-[520/248]"
      venueClass="text-xs"
      titleClass="text-2xl font-extrabold"
      periodClass="text-sm"
      contentPaddingClass="p-5"
    />
  );
}
