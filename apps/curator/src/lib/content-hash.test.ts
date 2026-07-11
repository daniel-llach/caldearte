import { test } from "node:test";
import assert from "node:assert/strict";
import { hashContent } from "./content-hash.js";

test("hashContent: identical content hashes equal", () => {
  const html = "<div><h1>Muestra de arte</h1><p>Inauguración 10/07</p></div>";
  assert.equal(hashContent(html), hashContent(html));
});

test("hashContent: a real content change hashes differently", () => {
  const before = "<div><h1>Muestra de arte</h1><p>Inauguración 10/07</p></div>";
  const after = "<div><h1>Muestra de arte</h1><p>Inauguración 17/07</p></div>";
  assert.notEqual(hashContent(before), hashContent(after));
});

test("hashContent: whitespace-only changes hash the same", () => {
  const compact = "<div><h1>Muestra</h1><p>Texto</p></div>";
  const spread = "<div>\n  <h1>Muestra</h1>\n\n  <p>Texto</p>\n</div>\n";
  assert.equal(hashContent(compact), hashContent(spread));
});
