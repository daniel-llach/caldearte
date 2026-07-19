"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { esCL } from "@/i18n/es-CL";
import type { City } from "@/lib/cities";
import type { WindowMode } from "@/lib/events";
import { fmtHeaderDate, fmtWeekHeader } from "@/lib/date";

interface HeaderProps {
  city: City;
  familyMode: boolean;
  today: string; // YYYY-MM-DD — Día mode's header date, and the empty-state fallback in CalendarView
  windowMode: WindowMode;
  rangeStart: string; // YYYY-MM-DD
  rangeEnd: string; // YYYY-MM-DD
  inauguracionesCount: number;
  exposCount: number;
  onOpenCityPicker: () => void;
  cityPickerTriggerRef: RefObject<HTMLButtonElement | null>;
  onOpenMobileMenu: () => void;
  onToggleFamilyMode: () => void;
}

// Static per-page-load snapshot, not a live-ticking clock. Computed
// directly in render (server render time vs. client hydration time will
// differ by a few seconds) — suppressHydrationWarning on the element that
// displays it is React's designed escape hatch for exactly this kind of
// intentionally non-deterministic content (timestamps), rather than
// deferring the read into an effect just to dodge a hydration warning.
function loadTime(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Santiago",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  const dayPeriod = parts.find((p) => p.type === "dayPeriod")?.value.toLowerCase().replace(/\./g, "") ?? "";
  return `${hour}:${minute}${dayPeriod}`;
}

function FamilyModeToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`appearance-none flex items-center shrink-0 w-10 h-6 p-0.5 rounded-full transition-colors border-2 ${
        on ? "justify-end bg-city-pill-bg border-city-pill-bg" : "justify-start bg-white border-stone-300"
      }`}
    >
      <span className={`w-5 h-5 rounded-full ${on ? "bg-white" : "bg-stone-300"}`} />
    </button>
  );
}

export default function Header({
  city,
  familyMode,
  today,
  windowMode,
  rangeStart,
  rangeEnd,
  inauguracionesCount,
  exposCount,
  onOpenCityPicker,
  cityPickerTriggerRef,
  onOpenMobileMenu,
  onToggleFamilyMode,
}: HeaderProps) {
  const dateLabel = windowMode === "day" ? fmtHeaderDate(today) : fmtWeekHeader(rangeStart, rangeEnd);
  // A "current time of day" readout doesn't pair coherently with a 7-day
  // range — only shown in Día mode.
  const time = windowMode === "day" ? loadTime() : null;
  const windowSuffix = windowMode === "day" ? esCL.todaySuffix : esCL.thisWeekSuffix;

  return (
    <header>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="text-2xl md:text-5xl font-normal text-heading-gray">{esCL.appName}</span>
          <span className="hidden md:inline text-5xl font-extrabold text-heading-gray">
            {dateLabel}
            {time && (
              <span className="text-lg text-muted-gray ml-2 font-normal" suppressHydrationWarning>
                {time}
              </span>
            )}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-4 text-[15px] text-heading-gray shrink-0 pt-2">
          <Link href="/privacidad">{esCL.curatoria}</Link>
          <span className="text-stone-300">-</span>
          <span>{esCL.familyMode}</span>
          <FamilyModeToggle on={familyMode} onToggle={onToggleFamilyMode} />
        </div>

        <button onClick={onOpenMobileMenu} className="md:hidden text-heading-gray text-2xl leading-none shrink-0" aria-label={esCL.menu}>
          ☰
        </button>
      </div>

      <div className="md:hidden mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-heading-gray">{dateLabel}</span>
        {time && (
          <span className="text-sm text-muted-gray" suppressHydrationWarning>
            {time}
          </span>
        )}
      </div>

      <div className="mt-3 md:mt-4 flex items-center gap-2 flex-wrap text-[15px] md:text-xl text-heading-gray">
        <span>{esCL.headerSummary(inauguracionesCount, exposCount)}</span>
        <button
          ref={cityPickerTriggerRef}
          onClick={onOpenCityPicker}
          className="inline-flex items-center gap-1.5 bg-city-pill-bg text-city-pill-fg rounded-lg px-3 py-1.5 text-sm"
        >
          {city.name} {windowSuffix}
          {/* eslint-disable-next-line @next/next/no-img-element -- provided icon asset, verbatim per design decision */}
          <img src="/icons/chevron-down.svg" alt="" width={16} height={16} />
        </button>
      </div>
    </header>
  );
}
