#!/usr/bin/env node
/** Run all news-data cleanup steps in their required order. */
import { spawnSync } from "node:child_process";

const steps = [
  "scripts/apply-glossary-to-news.mjs",
  "scripts/fix-recursive-glossary-artifacts.mjs",
  "scripts/fix-known-political-summaries.mjs",
  "scripts/filter-untranslated-news.mjs",
  "scripts/fix-agency-dateline-location-errors.mjs",
  "scripts/filter-ai-hallucinated-actors.mjs",
  "scripts/filter-irrelevant-foreign-news.mjs",
  "scripts/deduplicate-news-articles.mjs",
  "scripts/group-news-events.mjs"
];

for (const script of steps) {
  console.log(`\n[postprocess] ${script}`);
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("\nNews post-processing completed.");
