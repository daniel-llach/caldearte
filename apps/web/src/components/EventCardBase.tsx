"use client";

import { useState } from "react";
import Link from "next/link";
import CardImage from "./CardImage";
import { anchorDateOnly, buildGoogleCalendarUrl, fmtInauguracionDate, fmtOpeningHour, fmtPeriod } from "@/lib/date";
import { deriveComuna } from "@/lib/comuna";
import { esCL } from "@/i18n/es-CL";
import type { EventRecord } from "@/lib/events";

// Google Maps "directions" turn-arrow glyph, not a location pin —
// `color` differs by context: white for the dark card button, dark for
// the light mobile menu row.
function DirectionsGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polyline points="15 14 20 9 15 4" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Inline "external link" glyph for the mobile menu row — NOT the same
// asset as the desktop icon (/icons/link-affordance.svg), which is
// designed to sit on the card's own dark background; reusing it on the
// light menu background risked an invisible (white-on-white) icon.
function ExternalLinkGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="15 3 21 3 21 9" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="10" y1="14" x2="21" y2="3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// "Add to calendar" glyph (calendar + plus) for the menu row.
function CalendarGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" stroke={color} strokeWidth="2" />
      <line x1="3" y1="10" x2="21" y2="10" stroke={color} strokeWidth="2" />
      <line x1="8" y1="3" x2="8" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="16" y1="3" x2="16" y2="7" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="13" x2="12" y2="18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="9.5" y1="15.5" x2="14.5" y2="15.5" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Simplified WhatsApp glyph (speech bubble + phone squiggle) — not a
// pixel-exact brand asset, matching this file's existing plain-line-icon
// style (none of these glyphs are exact brand logos).
function WhatsAppGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path
        d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2z"
        stroke={color}
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M8.5 8.5c-.3 1 .1 2.2 1.3 3.6 1.2 1.4 2.5 2 3.6 2.2.8.1 1.4-.4 1.6-1l.2-.6c.1-.3 0-.6-.3-.8l-1.4-.9c-.3-.2-.6-.1-.8.1l-.4.5c-.6-.2-1.2-.6-1.7-1.2-.5-.6-.8-1.2-.9-1.8l.5-.4c.2-.2.3-.5.1-.8l-.9-1.5c-.2-.3-.5-.4-.8-.3l-.6.2z"
        fill={color}
      />
    </svg>
  );
}

// X/Twitter glyph.
function XGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <line x1="4" y1="4" x2="20" y2="20" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <line x1="20" y1="4" x2="4" y2="20" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Facebook "f" monogram glyph.
function FacebookGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2" />
      <path
        d="M13.5 9h1.5V6.5h-1.8c-1.6 0-2.7 1-2.7 2.7V11H9v2.5h1.5V18h2.5v-4.5h1.7l.3-2.5h-2V9.4c0-.3.1-.4.4-.4z"
        fill={color}
      />
    </svg>
  );
}

// "Copy link" glyph (two overlapping rounded rectangles) — the generic
// fallback for Instagram/TikTok/email/anywhere else that has no direct
// web share intent.
function CopyGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="9" y="9" width="12" height="12" rx="2" stroke={color} strokeWidth="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// Standard "share" glyph (three connected nodes) for the top-level
// "Compartir" row/button, which reveals the actual share targets below.
function ShareGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke={color} strokeWidth="2" />
      <circle cx="6" cy="12" r="3" stroke={color} strokeWidth="2" />
      <circle cx="18" cy="19" r="3" stroke={color} strokeWidth="2" />
      <line x1="8.6" y1="10.6" x2="15.4" y2="6.4" stroke={color} strokeWidth="2" />
      <line x1="8.6" y1="13.4" x2="15.4" y2="17.6" stroke={color} strokeWidth="2" />
    </svg>
  );
}

// "Back" arrow for returning from the share sub-menu to the main one.
function BackArrowGlyph({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <polyline points="15 18 9 12 15 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function KebabGlyph() {
  return (
    <svg width="4" height="16" viewBox="0 0 4 16" fill="white" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="2" cy="2" r="1.7" />
      <circle cx="2" cy="8" r="1.7" />
      <circle cx="2" cy="14" r="1.7" />
    </svg>
  );
}

interface EventCardBaseProps {
  event: EventRecord;
  // "inauguracion": show only the single opening date (+ hour, or a
  // consult-the-venue suggestion when no hour is confirmed) — never the
  // exhibition's full run. "expo": the exhibition's full run range, same
  // as before. Real bug, found 2026-07-20: both used to render the same
  // full-run text, so an inauguración card showed the whole run through
  // closing day instead of just its own opening date.
  variant: "inauguracion" | "expo";
  imageAspectClass: string; // e.g. "aspect-[520/248]"
  venueClass: string;
  titleClass: string;
  periodClass: string;
  contentPaddingClass: string;
  // True only on the event's own /eventos/[id] page: that page already
  // shows "Ver fuente original" prominently in its own attribution block
  // (see docs/risks.md's ToS note — the whole point of that page is
  // unmissable attribution), so this skips (a) the whole-card self-link
  // (pointless — the visitor is already on that exact page) and (b) the
  // collapsed kebab menu, replacing it with the other actions (Cómo
  // llegar/Agregar a mi calendario/Compartir) as visible buttons below the
  // card instead of one click away.
  standalone?: boolean;
}

export default function EventCardBase({
  event,
  variant,
  imageAspectClass,
  venueClass,
  titleClass,
  periodClass,
  contentPaddingClass,
  standalone = false,
}: EventCardBaseProps) {
  const anchor = anchorDateOnly(event);
  const dateLine =
    variant === "inauguracion" && event.openingDatetime
      ? `${fmtInauguracionDate(event.openingDatetime)} - ${
          event.openingTimeConfirmed ? fmtOpeningHour(event.openingDatetime) : esCL.consultHourWithVenue
        }`
      : // "expo" variant: just the exhibition's run range, never an hour —
        // a specific time only ever means something for an inauguración (a
        // moment to show up), not for browsing an exhibition's run. Real
        // bug, found 2026-07-20: this used to append the same hour suffix
        // as the inauguración variant, so "Expos Actuales" showed things
        // like "9 al 26 de julio - 08:30 hr".
        anchor && fmtPeriod(event.runStartDate, event.runEndDate, anchor);

  const displayedVenue = event.placeName ?? event.freeformLocation;
  const comuna = deriveComuna(event.freeformLocation, event.placeName);
  // Don't repeat the comuna if it's already visible inside the venue text
  // itself (e.g. "MAC Quinta Normal" already says Quinta Normal).
  const comunaAlreadyShown = comuna !== null && displayedVenue.toLowerCase().includes(comuna.toLowerCase());
  const venueLine = comuna && !comunaAlreadyShown ? `${displayedVenue} — ${comuna}` : displayedVenue;

  // "Cómo llegar" — Google Maps DIRECTIONS (not a plain search pin), since
  // that's what a visitor actually wants: a route from wherever they are
  // to the venue. No lat/lng needed — Maps resolves a text address itself,
  // and venueLine (already the most specific string we have: placeName,
  // falling back to freeformLocation, with comuna appended when it isn't
  // already implied) is a good enough query on its own; ", Chile" just
  // disambiguates internationally.
  const mapsQuery = venueLine.trim() ? `${venueLine}, Chile` : null;
  const mapsHref = mapsQuery ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsQuery)}` : null;

  // "Agregar a mi calendario" — inauguraciones only (expos have no single
  // event moment) and only once a real opening date exists.
  const calendarHref =
    variant === "inauguracion" && event.openingDatetime
      ? buildGoogleCalendarUrl({
          title: event.title,
          openingDatetime: event.openingDatetime,
          openingTimeConfirmed: event.openingTimeConfirmed,
          description: event.description,
          sourceUrl: event.sourceUrl,
          venueLine,
        })
      : null;

  // Both action icons collapse into a single "more options" (kebab)
  // button, opening a small menu with the two destinations, each labeled.
  // Originally mobile-only, but the user liked the collapsed UX enough
  // (2026-07-20) to want it everywhere — no more desktop/mobile split.
  const [menuOpen, setMenuOpen] = useState(false);
  // Whether the kebab/standalone menu is currently showing the share
  // targets (WhatsApp/X/Facebook/Copiar) instead of its main options —
  // "Compartir" is a row/button that reveals these on click, with a "←
  // Volver" row to go back, rather than listing all of them flat.
  const [shareSubmenuOpen, setShareSubmenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // "Compartir" is always available (every event has its own /eventos/[id]
  // permalink — see docs/risks.md's ToS note: that page's whole point is
  // making source attribution unmissable, not this card), so the menu
  // itself is now always shown, not conditioned on the other actions.
  const hasActions = true;

  // Deliberately NOT navigator.share: its OS-native sheet is inconsistent
  // across platforms — great on mobile when WhatsApp/Instagram are
  // installed, but on desktop (confirmed via a real screenshot, macOS
  // Safari) it only offers Mail/Messages/AirDrop/Notes, no social
  // networks at all. A custom menu with explicit, always-available
  // targets is more predictable, and WhatsApp specifically is the
  // dominant sharing channel for this audience (Chile) — a direct button
  // beats making people find it inside a system sheet. Instagram/TikTok
  // have no public web share-intent URL at all (their composers only
  // accept content from their own native apps), so those aren't buttons
  // here — "Copiar link" covers pasting into either, or anywhere else.
  function eventUrl(): string {
    return `${window.location.origin}/eventos/${event.id}`;
  }

  function openShareIntent(url: string) {
    setMenuOpen(false);
    setShareSubmenuOpen(false);
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function handleShareWhatsApp() {
    openShareIntent(`https://api.whatsapp.com/send?text=${encodeURIComponent(`${event.title} — ${eventUrl()}`)}`);
  }

  function handleShareTwitter() {
    openShareIntent(`https://twitter.com/intent/tweet?text=${encodeURIComponent(event.title)}&url=${encodeURIComponent(eventUrl())}`);
  }

  function handleShareFacebook() {
    openShareIntent(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(eventUrl())}`);
  }

  function handleCopyLink() {
    setMenuOpen(false);
    setShareSubmenuOpen(false);
    navigator.clipboard
      .writeText(eventUrl())
      .then(() => {
        setLinkCopied(true);
        setTimeout(() => setLinkCopied(false), 2000);
      })
      .catch(() => {
        // clipboard permission denied/unavailable — no-op, same
        // silent-fail posture as this file's other best-effort actions
      });
  }

  const card = (
    // h-full relies on a CSS Grid context (home/archive) to resolve against
    // — the row height comes from stretch + the tallest sibling's content.
    // Standalone has no such context (no siblings, no grid), so h-full
    // would resolve against nothing and collapse to 0 — omitted there,
    // letting the card (and the now-uncropped image inside it) size to its
    // own natural content height instead.
    <div className={`relative bg-black rounded-2xl overflow-hidden flex flex-col ${standalone ? "" : "h-full"}`}>
      {/* Whole-card link to the event's own /eventos/[id] permalink — an
          absolutely positioned overlay, not a wrapper, specifically so the
          kebab button/menu below (both explicitly z-20) can sit as SIBLINGS
          and take click precedence over this z-10 overlay instead of being
          invalidly nested inside an <a> (real <a>/<button> menu items can't
          nest inside another <a>). Skipped entirely when standalone — the
          visitor is already on this exact event's own page. */}
      {!standalone && (
        <Link href={`/eventos/${event.id}`} aria-label={esCL.eventCardAriaLabel(event.title)} className="absolute inset-0 z-10" />
      )}
      <div className={standalone ? "shrink-0" : `shrink-0 h-[185.53px] ${imageAspectClass}`}>
        <CardImage imageUrl={event.imageUrl} sourceUrl={event.sourceUrl} sensitivityTags={event.sensitivityTags} fullSize={standalone} />
      </div>
      <div className={`flex flex-col gap-1.5 ${contentPaddingClass}`}>
        <p className={`${venueClass} text-venue-gray truncate`}>{venueLine}</p>
        <p className={`${titleClass} text-white`}>{event.title}</p>
        {dateLine && <p className={`${periodClass} text-period-gray`}>{dateLine}</p>}
      </div>

      {/* A single kebab button opens a small menu with both destinations,
          each with an icon + label — same collapsed treatment on every
          screen size (originally mobile-only, promoted to desktop too on
          2026-07-20 per explicit feedback: "me encanto el menu kebab lo
          quiero para desktop tambien"). Not shown when standalone — see
          the visible button row below instead. */}
      {!standalone && hasActions && (
        <div className="absolute bottom-3 right-3">
          {menuOpen && (
            <>
              <button
                type="button"
                aria-label={esCL.cardMoreOptionsAriaLabel}
                className="fixed inset-0 z-10"
                onClick={() => {
                  setMenuOpen(false);
                  setShareSubmenuOpen(false);
                }}
              />
              <div role="menu" className="absolute bottom-10 right-0 z-20 min-w-[190px] overflow-hidden rounded-xl bg-white shadow-lg py-1">
                {!shareSubmenuOpen ? (
                  <>
                    {mapsHref && (
                      <a
                        href={mapsHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                        onClick={() => setMenuOpen(false)}
                      >
                        <DirectionsGlyph color="black" />
                        {esCL.cardMenuDirections}
                      </a>
                    )}
                    {event.sourceUrl && (
                      <a
                        href={event.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                        onClick={() => setMenuOpen(false)}
                      >
                        <ExternalLinkGlyph color="black" />
                        {esCL.cardMenuSource}
                      </a>
                    )}
                    {calendarHref && (
                      <a
                        href={calendarHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        role="menuitem"
                        className="flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                        onClick={() => setMenuOpen(false)}
                      >
                        <CalendarGlyph color="black" />
                        {esCL.cardMenuAddToCalendar}
                      </a>
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={() => setShareSubmenuOpen(true)}
                    >
                      <ShareGlyph color="black" />
                      {esCL.cardMenuShare}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={() => setShareSubmenuOpen(false)}
                    >
                      <BackArrowGlyph color="black" />
                      {esCL.cardMenuBack}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={handleShareWhatsApp}
                    >
                      <WhatsAppGlyph color="black" />
                      {esCL.cardMenuWhatsApp}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={handleShareTwitter}
                    >
                      <XGlyph color="black" />
                      {esCL.cardMenuTwitter}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={handleShareFacebook}
                    >
                      <FacebookGlyph color="black" />
                      {esCL.cardMenuFacebook}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                      onClick={handleCopyLink}
                    >
                      <CopyGlyph color="black" />
                      {esCL.cardMenuCopyLink}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {linkCopied && (
            <div className="absolute bottom-10 right-0 z-20 whitespace-nowrap rounded-lg bg-black/80 text-white text-xs px-2.5 py-1.5">
              {esCL.shareLinkCopied}
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen((open) => !open);
              setShareSubmenuOpen(false);
            }}
            aria-label={esCL.cardMoreOptionsAriaLabel}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="relative z-20 w-8 h-8 rounded-full border border-white/70 flex items-center justify-center"
          >
            <KebabGlyph />
          </button>
        </div>
      )}
    </div>
  );

  if (!standalone) return card;

  // Standalone (/eventos/[id]): the same three actions, but as visible
  // medium buttons below the card instead of collapsed into a kebab menu —
  // "Ver fuente original" is deliberately excluded here, since that page
  // already shows its own prominent attribution block separately.
  const buttonClass = "flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm font-semibold text-heading-gray";
  return (
    <div className="relative flex flex-col gap-3">
      {card}
      <div className="flex flex-wrap gap-2">
        {mapsHref && (
          <a href={mapsHref} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            <DirectionsGlyph color="black" />
            {esCL.cardMenuDirections}
          </a>
        )}
        {calendarHref && (
          <a href={calendarHref} target="_blank" rel="noopener noreferrer" className={buttonClass}>
            <CalendarGlyph color="black" />
            {esCL.cardMenuAddToCalendar}
          </a>
        )}
        <div className="relative">
          <button type="button" onClick={() => setShareSubmenuOpen((open) => !open)} className={buttonClass}>
            <ShareGlyph color="black" />
            {esCL.cardMenuShare}
          </button>
          {shareSubmenuOpen && (
            <>
              <button
                type="button"
                aria-label={esCL.cardMoreOptionsAriaLabel}
                className="fixed inset-0 z-10"
                onClick={() => setShareSubmenuOpen(false)}
              />
              <div className="absolute top-full left-0 mt-2 z-20 min-w-[190px] overflow-hidden rounded-xl bg-white border border-stone-200 shadow-lg py-1">
                {/* No "Volver" here (unlike the kebab menu's share sub-menu)
                    — this is its own standalone popover, not a step inside a
                    bigger menu with other options to return to. Clicking
                    "Compartir" again, or outside, closes it the same way. */}
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                  onClick={handleShareWhatsApp}
                >
                  <WhatsAppGlyph color="black" />
                  {esCL.cardMenuWhatsApp}
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                  onClick={handleShareTwitter}
                >
                  <XGlyph color="black" />
                  {esCL.cardMenuTwitter}
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                  onClick={handleShareFacebook}
                >
                  <FacebookGlyph color="black" />
                  {esCL.cardMenuFacebook}
                </button>
                <button
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-heading-gray"
                  onClick={handleCopyLink}
                >
                  <CopyGlyph color="black" />
                  {esCL.cardMenuCopyLink}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      {linkCopied && (
        <div className="absolute -top-8 right-0 whitespace-nowrap rounded-lg bg-black/80 text-white text-xs px-2.5 py-1.5">
          {esCL.shareLinkCopied}
        </div>
      )}
    </div>
  );
}
