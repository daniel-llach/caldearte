import { run } from "./event-discovery/run.js";

// BRIGHT_SOURCES_ONLY (2026-07-23): set by event-discovery.yml's
// workflow_dispatch input of the same name, for a manual "just refresh
// bright sources" run that shouldn't also spend on the next due comuna
// batch — see RunDeps.brightSourcesOnly's own doc comment.
await run({ brightSourcesOnly: process.env.BRIGHT_SOURCES_ONLY === "true" });
