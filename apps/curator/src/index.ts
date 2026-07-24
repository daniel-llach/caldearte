import { run } from "./event-discovery/run.js";

// BRIGHT_SOURCES_ONLY (2026-07-23): set by event-discovery.yml's
// workflow_dispatch input of the same name, for a manual "just refresh
// bright sources" run that shouldn't also spend on the next due comuna
// batch — see RunDeps.brightSourcesOnly's own doc comment.
//
// BRIGHT_SOURCE_URLS (2026-07-23): comma-separated substrings, each
// matched against a bright source's own url — set to debug one or a few
// named sources on demand, ignoring their own fetch cadence entirely, see
// RunDeps.brightSourceUrlFilter's own doc comment. Implies
// brightSourcesOnly when set, since there's rarely a reason to also want
// the comuna batch while debugging one named source.
const brightSourceUrlFilter = process.env.BRIGHT_SOURCE_URLS?.split(",")
  .map((s) => s.trim())
  .filter(Boolean);

await run({
  brightSourcesOnly: process.env.BRIGHT_SOURCES_ONLY === "true" || Boolean(brightSourceUrlFilter?.length),
  brightSourceUrlFilter,
});
