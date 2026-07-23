import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase-client";
import { fetchApprovedEvents, truncateDescription } from "@/lib/events";
import { extractDomain, resolveCardImage } from "@/lib/image-source";
import { dateOnlyFromIso, todayInSantiago } from "@/lib/date";
import { esCL } from "@/i18n/es-CL";
import InauguracionCard from "@/components/InauguracionCard";
import ExpoCard from "@/components/ExpoCard";
import Footer from "@/components/Footer";

export const revalidate = 3600; // matches the archive/sitemap revalidate window

interface PageParams {
  id: string;
}

export async function generateStaticParams() {
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  return events.map((e) => ({ id: e.id }));
}

export async function generateMetadata({ params }: { params: Promise<PageParams> }): Promise<Metadata> {
  const { id } = await params;
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  const event = events.find((e) => e.id === id);
  if (!event) return {};

  const description = truncateDescription(event.description) ?? event.title;
  const image = resolveCardImage(event);
  const title = `${event.title} | ${esCL.appName}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: image.type === "photo" ? [image.url] : undefined,
    },
    // Twitter/X's crawler falls back to og:image for the image itself, but
    // NOT for the card type — without an explicit "summary_large_image"
    // here it renders the small square "summary" thumbnail from
    // layout.tsx's site-wide default instead of the bigger, more visually
    // compelling card (this is what WhatsApp shares' link previews are
    // reusing too — asked about explicitly, 2026-07-21: "se comparte con
    // imagen?").
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image.type === "photo" ? [image.url] : undefined,
    },
  };
}

export default async function EventPage({ params }: { params: Promise<PageParams> }) {
  const { id } = await params;
  const { events } = await fetchApprovedEvents(getSupabaseClient());
  const event = events.find((e) => e.id === id);
  if (!event) notFound();

  const domain = event.sourceUrl ? extractDomain(event.sourceUrl) : null;
  // Longer than the OG/metadata excerpt above (still never the full,
  // near-verbatim text — see truncateDescription's own doc comment) —
  // enough to be genuinely useful, cut with "…" right before the source
  // link/attribution block, so a reader who wants the rest has an obvious
  // next step instead of a dead end.
  const description = truncateDescription(event.description, 500);

  return (
    <main className="min-h-screen w-full bg-white px-4 py-8 md:px-[61px] max-w-[680px] mx-auto">
      <Link href="/" className="text-sm text-muted-gray">
        ← {esCL.appName}
      </Link>

      {/* Real bug, found 2026-07-23: this used to check only whether
          openingDatetime was set at all, regardless of whether it had
          already passed — a past-but-still-running exhibition (e.g. an
          opening from two months ago that's still on display) rendered as
          an Inauguración card here, which only ever shows the single
          opening date/hour, hiding the exhibition's actual run range
          entirely. The homepage grid already gets this right
          (splitInauguracionesYExpos, lib/events.ts) by only highlighting an
          opening within the current window — mirror that same "hasn't
          happened yet" condition here instead of the page's own, simpler,
          inconsistent rule. */}
      <div className="mt-6">
        {event.openingDatetime && dateOnlyFromIso(event.openingDatetime) >= todayInSantiago() ? (
          <InauguracionCard event={event} standalone />
        ) : (
          <ExpoCard event={event} standalone />
        )}
      </div>

      {description && <p className="mt-4 text-sm text-heading-gray">{description}</p>}

      {domain && event.sourceUrl && (
        <div className="mt-4 flex flex-col gap-1 text-sm">
          <div className="flex items-center gap-2 text-heading-gray">
            <span className="font-semibold">{esCL.eventPageSourceLabel(domain)}</span>
            <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {esCL.eventPageSourceLink}
            </a>
          </div>
          <p className="text-muted-gray">{esCL.eventPageAttributionNote(domain)}</p>
        </div>
      )}

      <Link href="/" className="mt-6 inline-block text-sm font-semibold text-heading-gray underline">
        {esCL.eventPageBackToHome} →
      </Link>

      <Footer />
    </main>
  );
}
