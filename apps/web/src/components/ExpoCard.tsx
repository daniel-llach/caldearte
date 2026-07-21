import EventCardBase from "./EventCardBase";
import type { EventRecord } from "@/lib/events";

export default function ExpoCard({ event, standalone }: { event: EventRecord; standalone?: boolean }) {
  return (
    <EventCardBase
      event={event}
      variant="expo"
      imageAspectClass="aspect-[347/174]"
      venueClass="text-xs"
      titleClass="text-lg font-bold"
      periodClass="text-sm"
      contentPaddingClass="p-4"
      standalone={standalone}
    />
  );
}
