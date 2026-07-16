#!/usr/bin/env node
/** Lightweight structural validation for the repository. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywordConfig = await readJson("data/search-keywords.json");
const queries = Object.entries(keywordConfig)
  .filter(([key]) => !key.startsWith("_"))
  .flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!queries.length) throw new Error("Search keyword list is empty");
if (new Set(queries).size !== queries.length) throw new Error("Duplicate search keywords found");
for (const required of ["\"بسماية\"", "\"شركة هانوا\""]) {
  if (!queries.includes(required)) throw new Error(`Required search keyword missing: ${required}`);
}

const sources = await readJson("data/iraq-media-sources.json");
const sourceText = JSON.stringify(sources).toLowerCase();
if (sourceText.includes("ninanews.com") || sources.some((source) => String(source.id || "").toLowerCase() === "nina")) {
  throw new Error("NINA must remain excluded from configured sources");
}

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
const scriptRefs = [...indexHtml.matchAll(/<script\s+src="\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
if (scriptRefs.length !== 1 || scriptRefs[0] !== "app.js") {
  throw new Error(`index.html must load only app.js; found: ${scriptRefs.join(", ")}`);
}

const syntaxFiles = [
  "app.js",
  "scripts/collect-news.mjs",
  "scripts/run-report-style-collector.mjs",
  "scripts/refine-report-writing.mjs",
  "scripts/postprocess-news.mjs",
  "scripts/generate-weekly-report.mjs",
  "scripts/validate-project.mjs",
  "scripts/apply-glossary-to-news.mjs",
  "scripts/fix-recursive-glossary-artifacts.mjs",
  "scripts/fix-known-political-summaries.mjs",
  "scripts/filter-untranslated-news.mjs",
  "scripts/fix-agency-dateline-location-errors.mjs",
  "scripts/filter-ai-hallucinated-actors.mjs",
  "scripts/filter-irrelevant-foreign-news.mjs",
  "scripts/deduplicate-news-articles.mjs"
];
for (const file of syntaxFiles) {
  await fs.access(path.join(ROOT, file));
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Validated ${queries.length} search queries, ${sources.length} media sources and ${syntaxFiles.length} JavaScript files.`);
