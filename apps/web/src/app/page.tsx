import { cookies, headers } from "next/headers";
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
import { DEFAULT_CITY_ID, buildRegionMetaByCityId, resolveDefaultCityId } from "@/lib/cities";
import { todayInSantiago } from "@/lib/date";
import { CITY_COOKIE, FAMILY_MODE_COOKIE } from "@/lib/cookies";
import CalendarView from "@/components/CalendarView";

export default async function HomePage() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  // Absent cookie means family mode ON — a first-time visitor sees
  // filtered content by default; explicitly turning it off (empty-string
  // cookie value, set by CalendarView.tsx's toggleFamilyMode) is the only
  // way to see everything.
  const familyModeCookie = cookieStore.get(FAMILY_MODE_COOKIE)?.value;
  const familyMode = familyModeCookie === undefined ? true : Boolean(familyModeCookie);
  const today = todayInSantiago();

  const { events: allEvents, regions } = await fetchApprovedEvents(getSupabaseClient());
  // Family-mode filtering happens here, server-side, before anything is
  // sent to the client — excluded events never reach the HTML/JS, which is
  // what actually satisfies "no flash of unblurred content" (overview.md).
  const visible = filterFamilyMode(allEvents, familyMode);

  // Real observed city names, not a fixed list — any comuna a real event
  // resolves to (see cities.ts) is a legitimate, navigable destination.
  // Built from ALL events (not just active-today), so a directly-navigated
  // city still shows its proper name even with zero active events right now.
  const cityNames = cityNamesFromEvents(allEvents);

  // Home shows only what's visitable *today* — nothing not yet started,
  // nothing already ended.
  const activeToday = filterActiveToday(visible, today);
  const cityCounts = countByCity(activeToday, today);

  // A manual pick (CITY_COOKIE) always wins and is never re-resolved. With
  // no cookie yet, resolve fresh from Vercel's IP-geolocation headers every
  // render — own comuna (if it has events) -> a comuna in the same admin
  // región that does -> Santiago if outside Chile or nothing matched.
  // These headers don't exist on localhost (no-op there, falls through to
  // Santiago) — real geo-detection only happens on an actual Vercel deploy.
  const cityCookieValue = cookieStore.get(CITY_COOKIE)?.value;
  const cityId =
    cityCookieValue !== undefined
      ? cityCookieValue in cityNames || cityCookieValue === DEFAULT_CITY_ID
        ? cityCookieValue
        : DEFAULT_CITY_ID
      : resolveDefaultCityId(
          headerStore.get("x-vercel-ip-city") ?? undefined,
          headerStore.get("x-vercel-ip-country") ?? undefined,
          buildRegionMetaByCityId(regions),
          cityCounts,
        );

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
        regions={regions}
      />
    </main>
  );
}
