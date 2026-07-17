import { cookies } from "next/headers";
import { getSupabaseClient } from "@/lib/supabase-client";
import {
  fetchApprovedEvents,
  filterFamilyMode,
  filterByCity,
  filterActiveToday,
  splitInauguracionesYExpos,
  countByCity,
  cityNamesFromEvents,
  findNextEvent,
} from "@/lib/events";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { todayInSantiago } from "@/lib/date";
import { CITY_COOKIE, FAMILY_MODE_COOKIE } from "@/lib/cookies";
import CalendarView from "@/components/CalendarView";

export default async function HomePage() {
  const cookieStore = await cookies();
  const familyMode = Boolean(cookieStore.get(FAMILY_MODE_COOKIE)?.value);
  const today = todayInSantiago();

  const allEvents = await fetchApprovedEvents(getSupabaseClient());
  // Family-mode filtering happens here, server-side, before anything is
  // sent to the client — excluded events never reach the HTML/JS, which is
  // what actually satisfies "no flash of unblurred content" (overview.md).
  const visible = filterFamilyMode(allEvents, familyMode);

  // Real observed city names, not a fixed list — any comuna a real event
  // resolves to (see cities.ts) is a legitimate, navigable destination.
  // Built from ALL events (not just active-today), so a directly-navigated
  // city still shows its proper name even with zero active events right now.
  const cityNames = cityNamesFromEvents(allEvents);
  const rawCityId = cookieStore.get(CITY_COOKIE)?.value ?? DEFAULT_CITY_ID;
  const cityId = rawCityId in cityNames || rawCityId === DEFAULT_CITY_ID ? rawCityId : DEFAULT_CITY_ID;

  // Home shows only what's visitable *today* — nothing not yet started,
  // nothing already ended.
  const activeToday = filterActiveToday(visible, today);
  const cityCounts = countByCity(activeToday, today);

  const cityEventsToday = filterByCity(activeToday, cityId);
  const { inauguraciones, exposActuales } = splitInauguracionesYExpos(cityEventsToday, today);

  // Empty-state fallback looks beyond "today" within the selected city, so
  // it can say "the next one is on X" instead of just "nothing."
  const nextEvent = findNextEvent(filterByCity(visible, cityId), today);

  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 md:px-[61px] max-w-[1280px] mx-auto">
      <CalendarView
        inauguraciones={inauguraciones}
        exposActuales={exposActuales}
        cityId={cityId}
        cityNames={cityNames}
        familyMode={familyMode}
        today={today}
        cityCounts={cityCounts}
        nextEvent={nextEvent}
      />
    </main>
  );
}
