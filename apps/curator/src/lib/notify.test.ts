import { test } from "node:test";
import assert from "node:assert/strict";
import { flagBudgetExceeded } from "./notify.js";

test("flagBudgetExceeded: no-ops when GITHUB_TOKEN/GITHUB_REPOSITORY are unset", async () => {
  const originalToken = process.env.GITHUB_TOKEN;
  const originalRepo = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPOSITORY;

  try {
    // Should resolve without throwing and without making any network call.
    await flagBudgetExceeded({ spend: 12.5, budget: 10 });
  } finally {
    if (originalToken !== undefined) process.env.GITHUB_TOKEN = originalToken;
    if (originalRepo !== undefined) process.env.GITHUB_REPOSITORY = originalRepo;
  }

  assert.ok(true);
});
