import type { MetadataRoute } from "next";
import { getSupabaseClient } from "@/lib/supabase-client";
import { fetchApprovedEvents, listArchiveMonths } from "@/lib/events";
import { todayInSantiago } from "@/lib/date";

export const revalidate = 3600; // matches the archive pages' own revalidate window

// Data-dependent since the "Expos anteriores" archive shipped — enumerates
// one URL per archived month, on top of the app's static routes.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://caldearte.com";
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  const archiveUrls: MetadataRoute.Sitemap = listArchiveMonths(events, todayInSantiago()).map(({ year, month }) => ({
    url: `${base}/expos-anteriores/${year}/${String(month).padStart(2, "0")}`,
    changeFrequency: "monthly",
    priority: 0.5,
  }));
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/privacidad`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/contacto`, changeFrequency: "yearly", priority: 0.3 },
    ...archiveUrls,
  ];
}
