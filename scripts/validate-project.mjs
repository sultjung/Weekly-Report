#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywords = await readJson("data/search-keywords.json");
const domesticKeywords = await readJson("data/domestic-search-keywords.json");
const expectedKorean = ["비스마야", "한화 이라크", "이라크", "한화 김동관", "한화 김동선"];
const actualKorean = Array.isArray(domesticKeywords.queries) ? domesticKeywords.queries : [];
if (JSON.stringify(actualKorean) !== JSON.stringify(expectedKorean)) {
  throw new Error(`Korean domestic queries must be exactly: ${expectedKorean.join(", ")}`);
}
if (Object.prototype.hasOwnProperty.call(keywords, "korean_domestic_media")) {
  throw new Error("Korean domestic queries must stay outside the AI keyword file");
}

const allQueries = Object.entries(keywords)
  .filter(([key]) => !key.startsWith("_"))
  .flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!allQueries.length) throw new Error("Search keyword list is empty");
if (new Set(allQueries).size !== allQueries.length) throw new Error("Duplicate search keywords found");

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
for (const required of ["data-stat-filter=\"domestic\"", "id=\"statDomestic\"", ">국내 언론<"]) {
  if (!indexHtml.includes(required)) throw new Error(`Domestic dashboard markup missing: ${required}`);
}

const appJs = await fs.readFile(path.join(ROOT, "app.js"), "utf8");
for (const required of ["relatedNews", "관련뉴스", "previewText", "compact-card", "원문 보기", "전체 번역 보기", "translatedBody", "translationPreview"]) {
  if (!appJs.includes(required)) throw new Error(`News review UI missing: ${required}`);
}
if (appJs.includes("기사 내용 펼쳐보기")) throw new Error("Domestic article expand button must remain removed");

const domesticCollector = await fs.readFile(path.join(ROOT, "scripts", "collect-domestic-news.mjs"), "utf8");
for (const required of ["news.google.com/rss/search", "aiUsed: false", "relatedNews", "SPORTS_RE", "KEYWORDS_FILE"]) {
  if (!domesticCollector.includes(required)) throw new Error(`Domestic RSS collector rule missing: ${required}`);
}
const domesticPreview = await fs.readFile(path.join(ROOT, "scripts", "normalize-domestic-previews.mjs"), "utf8");
for (const required of ["previewText", "og:description", "twitter:description", "paragraphCandidates", "relatedNews"]) {
  if (!domesticPreview.includes(required)) throw new Error(`Domestic preview normalization rule missing: ${required}`);
}
const fullTranslation = await fs.readFile(path.join(ROOT, "scripts", "translate-full-articles.mjs"), "utf8");
for (const required of ["translatedTitleKo", "translatedBodyKo", "translatedBody", "fullTranslation", "translationPreview", "Do not summarize"]) {
  if (!fullTranslation.includes(required)) throw new Error(`Full article translation rule missing: ${required}`);
}

const workflow = await fs.readFile(path.join(ROOT, ".github/workflows/collect-news.yml"), "utf8");
if (/gpt-4o-mini/.test(workflow)) throw new Error("Collect workflow must not use gpt-4o-mini");
if (/node scripts\/refine-report-writing\.mjs/.test(workflow)) {
  throw new Error("Report-writing refinement must run only during final report generation, not news collection");
}
const stages = [
  "npm run collect",
  "node scripts/filter-regional-iraq-exposure.mjs",
  "node scripts/extract-article-facts.mjs",
  "npm run postprocess",
  "node scripts/translate-full-articles.mjs",
  "node scripts/collect-domestic-news.mjs",
  "node scripts/normalize-domestic-previews.mjs"
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
  "scripts/normalize-domestic-previews.mjs",
  "scripts/translate-full-articles.mjs",
  "scripts/editorial-rules.mjs",
  "scripts/article-fact-rules.mjs",
  "scripts/collect-sources-only.mjs",
  "scripts/collect-news.mjs",
  "scripts/filter-regional-iraq-exposure.mjs",
  "scripts/extract-article-facts.mjs",
  "scripts/normalize-extracted-entities.mjs",
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
console.log(`Validated ${allQueries.length} Iraq queries, ${expectedKorean.length} no-AI domestic RSS queries, full-body translation, and ${syntaxFiles.length} JavaScript files.`);
