import { redirect, notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase-client";
import { fetchApprovedEvents, listArchiveMonths } from "@/lib/events";
import { todayInSantiago } from "@/lib/date";

// Stable, data-independent link target — always redirects to the most
// recently archived month, so nothing outside this file needs to know
// which month that currently is.
export default async function ArchiveIndexPage() {
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  const [latest] = listArchiveMonths(events, todayInSantiago());
  if (!latest) notFound(); // no archived months yet
  redirect(`/expos-anteriores/${latest.year}/${String(latest.month).padStart(2, "0")}`);
}
