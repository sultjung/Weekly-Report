#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywords = await readJson("data/search-keywords.json");
const domesticKeywords = await readJson("data/domestic-search-keywords.json");
const expectedKorean = ["비스마야", "한화 이라크", "이라크", "한화 김동관", "한화 김동선"];
if (JSON.stringify(domesticKeywords.queries || []) !== JSON.stringify(expectedKorean)) {
  throw new Error(`Korean domestic queries must be exactly: ${expectedKorean.join(", ")}`);
}
if (Object.prototype.hasOwnProperty.call(keywords, "korean_domestic_media")) {
  throw new Error("Korean domestic queries must stay outside the AI keyword file");
}

const allQueries = Object.entries(keywords).filter(([key]) => !key.startsWith("_")).flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!allQueries.length) throw new Error("Search keyword list is empty");
if (new Set(allQueries).size !== allQueries.length) throw new Error("Duplicate search keywords found");

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
for (const required of ["data-stat-filter=\"domestic\"", "id=\"statDomestic\"", ">국내 언론<"]) {
  if (!indexHtml.includes(required)) throw new Error(`Domestic dashboard markup missing: ${required}`);
}

const appJs = await fs.readFile(path.join(ROOT, "app.js"), "utf8");
for (const required of ["relatedNews", "관련뉴스", "전체 기사 보기", "domestic-card"]) {
  if (!appJs.includes(required)) throw new Error(`Grouped domestic news UI missing: ${required}`);
}

const domesticCollector = await fs.readFile(path.join(ROOT, "scripts", "collect-domestic-news.mjs"), "utf8");
for (const required of ["news.google.com/rss/search", "aiUsed: false", "relatedNews", "SPORTS_RE", "한화 김동관", "한화 김동선"]) {
  if (!domesticCollector.includes(required)) throw new Error(`Domestic RSS collector rule missing: ${required}`);
}

const workflow = await fs.readFile(path.join(ROOT, ".github/workflows/collect-news.yml"), "utf8");
if (/gpt-4o-mini/.test(workflow)) throw new Error("Collect workflow must not use gpt-4o-mini");
const stages = [
  "npm run collect",
  "node scripts/filter-regional-iraq-exposure.mjs",
  "node scripts/extract-article-facts.mjs",
  "node scripts/refine-report-writing.mjs",
  "npm run postprocess",
  "node scripts/collect-domestic-news.mjs"
];
const positions = stages.map((stage) => workflow.indexOf(stage));
if (positions.some((value) => value < 0) || !positions.every((value, index) => index === 0 || value > positions[index - 1])) {
  throw new Error("Workflow stages are missing or out of order");
}
if (/prepare-domestic-media/.test(workflow)) throw new Error("Legacy domestic preparation step must be removed");

await fs.access(path.join(ROOT, "templates", "weekly-report-template.docx"));
await fs.access(path.join(ROOT, "scripts", "fill-weekly-template.py"));

const syntaxFiles = [
  "app.js",
  "scripts/collect-domestic-news.mjs",
  "scripts/editorial-rules.mjs",
  "scripts/article-fact-rules.mjs",
  "scripts/collect-sources-only.mjs",
  "scripts/collect-news.mjs",
  "scripts/filter-regional-iraq-exposure.mjs",
  "scripts/extract-article-facts.mjs",
  "scripts/normalize-extracted-entities.mjs",
  "scripts/refine-report-writing.mjs",
  "scripts/postprocess-news.mjs",
  "scripts/generate-weekly-report.mjs",
  "scripts/validate-project.mjs",
  "scripts/validate-regional-iraq-scope.mjs"
];
for (const file of syntaxFiles) {
  await fs.access(path.join(ROOT, file));
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Validated ${allQueries.length} AI queries, ${expectedKorean.length} no-AI domestic RSS queries, and ${syntaxFiles.length} JavaScript files.`);
