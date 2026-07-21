import EventCardBase from "./EventCardBase";
import type { EventRecord } from "@/lib/events";

export default function InauguracionCard({ event, standalone }: { event: EventRecord; standalone?: boolean }) {
  return (
    <EventCardBase
      event={event}
      variant="inauguracion"
      imageAspectClass="aspect-[520/248]"
      venueClass="text-xs"
      titleClass="text-2xl font-extrabold"
      periodClass="text-sm"
      contentPaddingClass="p-5"
      standalone={standalone}
    />
  );
}
