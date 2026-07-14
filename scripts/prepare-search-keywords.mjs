#!/usr/bin/env node
/**
 * Replace the generated collector's Google News query list with the single
 * authoritative configuration in data/search-keywords.json.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const KEYWORDS_FILE = path.join(ROOT, "data", "search-keywords.json");
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

const config = JSON.parse(await fs.readFile(KEYWORDS_FILE, "utf8"));
const groups = Object.entries(config).filter(([name]) => !name.startsWith("_"));

if (!groups.length) throw new Error("No search keyword groups found");

const queries = [];
const seen = new Set();

for (const [groupName, values] of groups) {
  if (!Array.isArray(values)) throw new Error(`Search keyword group must be an array: ${groupName}`);
  if (!values.length) throw new Error(`Search keyword group is empty: ${groupName}`);

  for (const raw of values) {
    const query = String(raw || "").trim();
    if (!query) throw new Error(`Empty search query in group: ${groupName}`);
    if (seen.has(query)) throw new Error(`Duplicate search query: ${query}`);
    seen.add(query);
    queries.push(query);
  }
}

const code = await fs.readFile(TARGET, "utf8");
const queryArrayPattern = /const GOOGLE_NEWS_QUERIES = \[[\s\S]*?\n\];/;

if (!queryArrayPattern.test(code)) {
  throw new Error("GOOGLE_NEWS_QUERIES array not found in generated collector");
}

const arrayBody = queries.map((query) => `  ${JSON.stringify(query)}`).join(",\n");
const replacement = `const GOOGLE_NEWS_QUERIES = [\n${arrayBody}\n];`;
const updated = code.replace(queryArrayPattern, replacement);

await fs.writeFile(TARGET, updated, "utf8");
console.log(`Loaded ${queries.length} Google News queries from ${path.relative(ROOT, KEYWORDS_FILE)}.`);
