import { createHash } from "node:crypto";

// Strips all whitespace so formatting/indentation-only diffs (a page
// re-rendered with different line breaks, but the same content) don't
// register as a "content changed" false positive.
function normalizeWhitespace(html: string): string {
  return html.replace(/\s+/g, "");
}

export function hashContent(html: string): string {
  return createHash("sha256").update(normalizeWhitespace(html), "utf8").digest("hex");
}
