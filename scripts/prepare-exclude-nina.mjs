#!/usr/bin/env node
/**
 * Exclude NINA from the generated Weekly-Report collector.
 *
 * NINA pages repeatedly mix related-news/sidebar text into the extracted
 * article body. The source is therefore excluded both from the configured
 * direct-source list and from Google News RSS results.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return source.replace(search, replacement);
}

let code = await fs.readFile(TARGET, "utf8");

const helperAnchor = `function uniqueRecent(items, limit = MAX_TOTAL) {\n  const cutoff = cutoffDate();\n  const map = new Map();\n  for (const item of items) {`;

code = replaceOnce(
  code,
  helperAnchor,
  `function isExcludedNinaArticle(item = {}) {\n  const source = String(item.source || item.publisher || "").trim();\n  const url = String(item.url || item.link || item.resolvedUrl || "");\n  return /^(NINA|وكالة الانباء العراقية \\(نينا\\)|وكالة الأنباء العراقية \\(نينا\\))$/i.test(source) ||\n    /ninanews\\.com/i.test(url);\n}\n\nfunction uniqueRecent(items, limit = MAX_TOTAL) {\n  const cutoff = cutoffDate();\n  const map = new Map();\n  for (const item of items) {\n    if (isExcludedNinaArticle(item)) continue;`,
  "exclude NINA before caching, AI summarization and output"
);

await fs.writeFile(TARGET, code, "utf8");
console.log("Applied complete NINA source exclusion.");
