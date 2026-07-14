#!/usr/bin/env node
/**
 * Single entry point for both GitHub Actions and local/manual collection.
 *
 * Usage:
 *   node scripts/run-collector.mjs
 *   node scripts/run-collector.mjs --prepare-only
 */

import { spawnSync } from "node:child_process";

const prepareOnly = process.argv.includes("--prepare-only");
const steps = [
  "scripts/prepare-expanded-weekly-collector.mjs",
  "scripts/prepare-bismayah-priority.mjs",
  "scripts/prepare-search-keywords.mjs",
  "scripts/prepare-human-analysis-prompt-v4.mjs",
  "scripts/prepare-evidence-first-summary.mjs",
  "scripts/prepare-exclude-nina.mjs",
  "scripts/prepare-report-scope-guard.mjs"
];

if (!prepareOnly) steps.push("scripts/collect-news.expanded.mjs");

for (const script of steps) {
  console.log(`\n[collector] ${script}`);
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(prepareOnly
  ? "\nCollector preparation and validation target generation completed."
  : "\nWeekly news collection completed.");
