// Date helpers. `activeRange`/`anchorDateOnly` exist because real events
// have a run (run_start_date/run_end_date), not just a single anchor date.

const MONTHS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "YYYY-MM-DD" -> local Date at midnight (never UTC — avoids off-by-one-day
// bugs from timezone conversion).
export function parseDateOnly(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toDateOnlyString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Extracts the calendar-date portion from either a plain date column
// ("2026-07-11") or a full ISO timestamptz ("2026-07-11T22:00:00+00:00").
export function dateOnlyFromIso(isoOrDate: string): string {
  return isoOrDate.slice(0, 10);
}

export function fmtShort(dateStr: string): string {
  const date = parseDateOnly(dateStr);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

// Header wordmark date, e.g. "14 JULIO" — day + month, uppercase, no year.
export function fmtHeaderDate(dateStr: string): string {
  const date = parseDateOnly(dateStr);
  return `${date.getDate()} ${MONTHS[date.getMonth()].toUpperCase()}`;
}

// Card period text, e.g. "12 al 28 de Julio" or, spanning two months,
// "28 de julio al 3 de agosto". Collapses to a single date when the run is
// one day (or there's no run at all, just an anchor).
export function fmtPeriod(runStartDate: string | null, runEndDate: string | null, anchorDate: string): string {
  const start = runStartDate ?? anchorDate;
  const end = runEndDate ?? anchorDate;

  if (start === end) {
    const d = parseDateOnly(start);
    return `${d.getDate()} de ${MONTHS[d.getMonth()]}`;
  }

  const s = parseDateOnly(start);
  const e = parseDateOnly(end);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return `${s.getDate()} al ${e.getDate()} de ${MONTHS[s.getMonth()]}`;
  }
  return `${s.getDate()} de ${MONTHS[s.getMonth()]} al ${e.getDate()} de ${MONTHS[e.getMonth()]}`;
}

// "- 19 hr" / "- 19:30 hr" suffix for an inauguración card. Chile-timezone,
// not the browser's/server's local time.
export function fmtOpeningHour(openingDatetimeIso: string): string {
  const parts = new Intl.DateTimeFormat("es-CL", {
    timeZone: "America/Santiago",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(openingDatetimeIso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return minute === "00" ? `${hour} hr` : `${hour}:${minute} hr`;
}

// The whole audience is in Chile — "today" must match Chile's calendar
// date, not the server's (Vercel defaults to UTC, which can be a day off
// from Chile around midnight). 'en-CA' formats as YYYY-MM-DD directly.
export function todayInSantiago(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago" }).format(new Date());
}

export interface EventDates {
  openingDatetime: string | null;
  runStartDate: string | null;
  runEndDate: string | null;
}

// The anchor date: opening_datetime when a source confirmed a real opening
// night, else the run's start date, else the run's end date as a last
// resort (mirrors the DB's events_has_some_date constraint — one of the
// three is always present).
export function anchorDateOnly(e: EventDates): string | null {
  if (e.openingDatetime) return dateOnlyFromIso(e.openingDatetime);
  if (e.runStartDate) return e.runStartDate;
  if (e.runEndDate) return e.runEndDate;
  return null;
}

// The inclusive [start, end] date range an event is considered "showing"
// for — a currently-running exhibition should appear as active every day
// of its run, not just once on an anchor date (overview.md's "full run"
// policy).
export function activeRange(e: EventDates): { start: string; end: string } | null {
  const anchor = anchorDateOnly(e);
  if (!anchor) return null;
  return {
    start: e.runStartDate ?? anchor,
    end: e.runEndDate ?? anchor,
  };
}

export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

// Mirrors apps/curator/src/event-discovery/discover.ts's isCurrentOrUpcoming:
// month-level, not day-level — an event is stale only once its run (or
// anchor) ended in a month before the current one. Used only by
// findNextEvent's empty-state lookahead; the home page's own "active
// today" filter is day-exact (see events.ts's filterActiveToday).
export function isCurrentOrUpcoming(e: EventDates, todayStr: string): boolean {
  const range = activeRange(e);
  if (!range) return false;
  const endMonth = parseDateOnly(range.end);
  const today = parseDateOnly(todayStr);
  const monthValue = (d: Date) => d.getFullYear() * 12 + d.getMonth();
  return monthValue(endMonth) >= monthValue(today);
}
