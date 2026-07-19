import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase-client";
import { fetchApprovedEvents, eventsForMonth, listArchiveMonths } from "@/lib/events";
import { fmtMonthYear, isArchivableMonth, todayInSantiago } from "@/lib/date";
import { esCL } from "@/i18n/es-CL";
import ArchiveMonthView from "@/components/archive/ArchiveMonthView";

export const revalidate = 3600;

interface PageParams {
  year: string;
  month: string;
}

export async function generateStaticParams() {
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  return listArchiveMonths(events, todayInSantiago()).map(({ year, month }) => ({
    year: String(year),
    month: String(month).padStart(2, "0"),
  }));
}

function parseParams(params: PageParams): { year: number; month: number } | null {
  const year = Number(params.year);
  const month = Number(params.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const parsed = parseParams(await params);
  if (!parsed) return {};
  const label = fmtMonthYear(parsed.year, parsed.month);
  const { events: allEvents } = await fetchApprovedEvents(getSupabaseClient());
  const monthEvents = eventsForMonth(allEvents, parsed.year, parsed.month);
  const sample = monthEvents.slice(0, 5).map((e) => e.title).join(", ");
  return {
    title: `${esCL.archiveMonthTitle(label)} | ${esCL.appName}`,
    description: monthEvents.length > 0
      ? `${monthEvents.length} exposiciones que abrieron en Chile en ${label}: ${sample}${monthEvents.length > 5 ? "…" : "."}`
      : `Exposiciones que abrieron en Chile en ${label}.`,
  };
}

function monthOffset(year: number, month: number, offset: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + offset;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthHref(year: number, month: number): string {
  return `/expos-anteriores/${year}/${String(month).padStart(2, "0")}`;
}

export default async function ArchiveMonthPage({ params }: { params: Promise<PageParams> }) {
  const parsed = parseParams(await params);
  if (!parsed) notFound();
  const { year, month } = parsed;

  const today = todayInSantiago();
  if (!isArchivableMonth(year, month, today)) notFound();

  const { events: allEvents } = await fetchApprovedEvents(getSupabaseClient());
  const monthEvents = eventsForMonth(allEvents, year, month);
  if (monthEvents.length === 0) notFound();

  const archivedMonths = new Set(listArchiveMonths(allEvents, today).map((m) => `${m.year}-${m.month}`));
  const prev = monthOffset(year, month, -1);
  const next = monthOffset(year, month, 1);
  const prevHref = archivedMonths.has(`${prev.year}-${prev.month}`) ? monthHref(prev.year, prev.month) : null;
  const nextHref = archivedMonths.has(`${next.year}-${next.month}`) ? monthHref(next.year, next.month) : null;

  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 md:px-[61px] max-w-[1280px] mx-auto">
      <Link href="/" className="text-sm text-muted-gray">
        ← {esCL.appName}
      </Link>
      <h1 className="text-3xl md:text-[41px] font-black tracking-wide text-heading-gray mt-6 mb-6">
        {esCL.archiveMonthTitle(fmtMonthYear(year, month))}
      </h1>
      <ArchiveMonthView events={monthEvents} year={year} month={month} prevHref={prevHref} nextHref={nextHref} />
    </main>
  );
}
