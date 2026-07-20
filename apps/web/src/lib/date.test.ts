import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fmtShort,
  fmtPeriod,
  fmtOpeningHour,
  anchorDateOnly,
  activeRange,
  rangesOverlap,
  isCurrentOrUpcoming,
  dateOnlyFromIso,
  weekBoundsInSantiago,
  fmtWeekHeader,
  fmtMonthYear,
  isArchivableMonth,
  monthBounds,
  fmtInauguracionDate,
  buildGoogleCalendarUrl,
} from "./date";

test("fmtShort formats a short date", () => {
  assert.equal(fmtShort("2026-07-11"), "11 jul");
});

test("dateOnlyFromIso extracts the date from a full timestamptz", () => {
  assert.equal(dateOnlyFromIso("2026-07-11T22:00:00+00:00"), "2026-07-11");
  assert.equal(dateOnlyFromIso("2026-07-11"), "2026-07-11");
});

test("anchorDateOnly prefers opening_datetime, then run_start_date, then run_end_date", () => {
  assert.equal(
    anchorDateOnly({ openingDatetime: "2026-07-11T22:00:00+00:00", runStartDate: "2026-07-01", runEndDate: "2026-08-01" }),
    "2026-07-11",
  );
  assert.equal(anchorDateOnly({ openingDatetime: null, runStartDate: "2026-07-01", runEndDate: "2026-08-01" }), "2026-07-01");
  assert.equal(anchorDateOnly({ openingDatetime: null, runStartDate: null, runEndDate: "2026-08-01" }), "2026-08-01");
  assert.equal(anchorDateOnly({ openingDatetime: null, runStartDate: null, runEndDate: null }), null);
});

test("activeRange spans run_start_date to run_end_date when both present", () => {
  assert.deepEqual(
    activeRange({ openingDatetime: null, runStartDate: "2026-07-05", runEndDate: "2026-09-30" }),
    { start: "2026-07-05", end: "2026-09-30" },
  );
});

test("activeRange collapses to a single day when there's only an anchor", () => {
  assert.deepEqual(
    activeRange({ openingDatetime: "2026-07-11T22:00:00+00:00", runStartDate: null, runEndDate: null }),
    { start: "2026-07-11", end: "2026-07-11" },
  );
});

test("rangesOverlap", () => {
  assert.equal(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-10", "2026-07-20"), true);
  assert.equal(rangesOverlap("2026-07-01", "2026-07-10", "2026-07-11", "2026-07-20"), false);
});

test("fmtPeriod: same-month run", () => {
  assert.equal(fmtPeriod("2026-07-12", "2026-07-28", "2026-07-12"), "12 al 28 de julio");
});

test("fmtPeriod: cross-month run", () => {
  assert.equal(fmtPeriod("2026-07-28", "2026-08-03", "2026-07-28"), "28 de julio al 3 de agosto");
});

test("fmtPeriod: single day (no run, just an anchor)", () => {
  assert.equal(fmtPeriod(null, null, "2026-07-11"), "11 de julio");
});

test("fmtInauguracionDate: always the single opening day, ignoring any run range", () => {
  assert.equal(fmtInauguracionDate("2026-07-11T23:00:00.000Z"), "11 de julio");
});

test("fmtOpeningHour: whole hour", () => {
  // 23:00 UTC = 19:00 in Chile (winter, UTC-4, no DST in July).
  assert.equal(fmtOpeningHour("2026-07-11T23:00:00.000Z"), "19 hr");
});

test("fmtOpeningHour: non-zero minutes", () => {
  assert.equal(fmtOpeningHour("2026-07-11T23:30:00.000Z"), "19:30 hr");
});

test("buildGoogleCalendarUrl: confirmed hour produces a timed event 2h apart", () => {
  const url = buildGoogleCalendarUrl({
    title: "Dejar Atrás",
    openingDatetime: "2026-07-15T23:00:00.000Z",
    openingTimeConfirmed: true,
    description: "Joaquín Reyes",
    sourceUrl: "https://example.com/dejar-atras",
    venueLine: "Isabel Croxatto Galería — Providencia",
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get("dates"), "20260715T230000Z/20260716T010000Z");
  assert.equal(params.get("text"), "Dejar Atrás");
  assert.equal(params.get("location"), "Isabel Croxatto Galería — Providencia");
  assert.equal(params.get("details"), "Joaquín Reyes\n\nhttps://example.com/dejar-atras");
  assert.equal(params.get("action"), "TEMPLATE");
});

test("buildGoogleCalendarUrl: unconfirmed hour produces an all-day event, no time component", () => {
  const url = buildGoogleCalendarUrl({
    title: "Sín-tesis",
    openingDatetime: "2026-07-14T04:00:00.000Z",
    openingTimeConfirmed: false,
    description: null,
    sourceUrl: null,
    venueLine: "Galería NAC",
  });
  const params = new URL(url).searchParams;
  assert.equal(params.get("dates"), "20260714/20260715");
  assert.equal(params.get("details"), "");
});

test("isCurrentOrUpcoming: a run that ended last month is stale", () => {
  assert.equal(
    isCurrentOrUpcoming({ openingDatetime: null, runStartDate: "2026-05-01", runEndDate: "2026-06-15" }, "2026-07-11"),
    false,
  );
});

test("isCurrentOrUpcoming: a run still ending this month or later is current", () => {
  assert.equal(
    isCurrentOrUpcoming({ openingDatetime: null, runStartDate: "2026-06-01", runEndDate: "2026-07-05" }, "2026-07-11"),
    true,
  );
  assert.equal(
    isCurrentOrUpcoming({ openingDatetime: "2026-08-01T22:00:00+00:00", runStartDate: null, runEndDate: null }, "2026-07-11"),
    true,
  );
});

test("weekBoundsInSantiago: a mid-week date (Saturday) resolves to that week's Monday-Sunday", () => {
  assert.deepEqual(weekBoundsInSantiago("2026-07-11"), { start: "2026-07-06", end: "2026-07-12" });
});

test("weekBoundsInSantiago: the Monday itself is already the start of its own window", () => {
  assert.deepEqual(weekBoundsInSantiago("2026-07-06"), { start: "2026-07-06", end: "2026-07-12" });
});

test("weekBoundsInSantiago: the Sunday itself is the END of its own window, not the start of the next", () => {
  assert.deepEqual(weekBoundsInSantiago("2026-07-12"), { start: "2026-07-06", end: "2026-07-12" });
});

test("fmtWeekHeader: same-month week", () => {
  assert.equal(fmtWeekHeader("2026-07-13", "2026-07-19"), "13 al 19 de JULIO");
});

test("fmtWeekHeader: week spanning a month boundary", () => {
  assert.equal(fmtWeekHeader("2026-07-27", "2026-08-02"), "27 de JULIO al 2 de AGOSTO");
});

test("fmtMonthYear formats a capitalized month name and year", () => {
  assert.equal(fmtMonthYear(2026, 7), "Julio 2026");
  assert.equal(fmtMonthYear(2026, 1), "Enero 2026");
});

test("isArchivableMonth: strictly before the current Santiago month is archivable", () => {
  assert.equal(isArchivableMonth(2026, 6, "2026-07-19"), true);
  assert.equal(isArchivableMonth(2026, 7, "2026-07-19"), false, "the current month itself is not archivable yet");
  assert.equal(isArchivableMonth(2026, 8, "2026-07-19"), false, "a future month is not archivable");
});

test("isArchivableMonth: a year boundary is handled correctly", () => {
  assert.equal(isArchivableMonth(2025, 12, "2026-01-15"), true);
  assert.equal(isArchivableMonth(2026, 1, "2026-01-15"), false);
});

test("monthBounds: a 31-day month", () => {
  assert.deepEqual(monthBounds(2026, 7), { start: "2026-07-01", end: "2026-07-31" });
});

test("monthBounds: February in a non-leap year", () => {
  assert.deepEqual(monthBounds(2026, 2), { start: "2026-02-01", end: "2026-02-28" });
});

test("monthBounds: February in a leap year", () => {
  assert.deepEqual(monthBounds(2028, 2), { start: "2028-02-01", end: "2028-02-29" });
});
