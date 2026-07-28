#!/usr/bin/env node
/** Structural validation aligned with the current collection policy. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywords = await readJson("data/search-keywords.json");
const groups = Object.entries(keywords).filter(([key]) => !key.startsWith("_"));
const queries = groups.flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!queries.length) throw new Error("Search keyword list is empty");
if (new Set(queries).size !== queries.length) throw new Error("Duplicate search keywords found");

const expectedKorean = [
  "\"비스마야\"",
  "\"한화\" \"이라크\"",
  "\"이라크\"",
  "\"한화\" \"김동관\"",
  "\"한화\" \"김동선\""
];
const actualKorean = keywords.korean_domestic_media || [];
if (JSON.stringify(actualKorean) !== JSON.stringify(expectedKorean)) {
  throw new Error(`Korean domestic-media queries must be exactly: ${expectedKorean.join(", ")}`);
}

for (const [group, values] of groups) {
  if (group === "korean_domestic_media") continue;
  for (const query of values || []) {
    if (/[가-힣]/.test(String(query))) throw new Error(`Korean query found outside domestic-media group: ${group} / ${query}`);
  }
}

for (const required of [
  "\"مجلس الوزراء العراقي\" \"قرارات\"",
  "\"مجلس النواب\" \"جلسة\" \"العراق\"",
  "\"الهيئة الوطنية للاستثمار\" \"تحقيق\"",
  "\"العراق\" \"داعش\"",
  "\"Iraq\" \"airspace closure\""
]) {
  if (!queries.includes(required)) throw new Error(`Required search keyword missing: ${required}`);
}

const forbiddenArabicEconomy = ["\"العراق\" \"النفط\"", "\"العراق\" \"الاقتصاد\"", "\"العراق\" \"الاستثمار\"", "\"العراق\" \"الإسكان\""];
for (const forbidden of forbiddenArabicEconomy) {
  if (queries.includes(forbidden)) throw new Error(`Arabic economy keyword must remain removed: ${forbidden}`);
}

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
for (const required of ["data-stat-filter=\"domestic\"", "id=\"statDomestic\"", ">국내 언론<"]) {
  if (!indexHtml.includes(required)) throw new Error(`Domestic media dashboard markup missing: ${required}`);
}
const scriptRefs = [...indexHtml.matchAll(/<script\s+src="\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
if (!scriptRefs.includes("app.js") || !scriptRefs.includes("update-time.js")) {
  throw new Error(`index.html must load app.js and update-time.js; found: ${scriptRefs.join(", ")}`);
}

const appJs = await fs.readFile(path.join(ROOT, "app.js"), "utf8");
for (const required of ["korean_domestic_media", "statDomestic", "domestic:'국내 언론'", "김동관", "김동선", "isStaleUnapprovedKorean"]) {
  if (!appJs.includes(required)) throw new Error(`Domestic media dashboard logic missing: ${required}`);
}

const domesticPreparation = await fs.readFile(path.join(ROOT, "scripts", "prepare-domestic-media.mjs"), "utf8");
for (const required of ["김동관", "김동선", "unrelatedKoreanRemoved", "SPORTS_RE"]) {
  if (!domesticPreparation.includes(required)) throw new Error(`Domestic media preparation rule missing: ${required}`);
}

const extractor = await fs.readFile(path.join(ROOT, "scripts", "extract-article-facts.mjs"), "utf8");
if (!/football|soccer|world cup|مباراة|منتخب|كرة|الدوري/i.test(extractor)) {
  throw new Error("Sports exclusion rules are missing from the fact extraction stage");
}

const workflow = await fs.readFile(path.join(ROOT, ".github/workflows/collect-news.yml"), "utf8");
if (/gpt-4o-mini/.test(workflow)) throw new Error("Collect workflow must not use gpt-4o-mini");

function workflowEnvHasDefault(name, literal, variableName) {
  const literalPattern = new RegExp(`${name}:\\s*["']?${literal.replace(/\./g, "\\.")}["']?`);
  const variablePattern = new RegExp(`${name}:\\s*\\$\\{\\{\\s*vars\\.${variableName}\\s*\\|\\|\\s*["']${literal.replace(/\./g, "\\.")}["']\\s*\\}\\}`);
  return literalPattern.test(workflow) || variablePattern.test(workflow);
}

if (!workflowEnvHasDefault("OPENAI_FACT_MODEL", "gpt-5.4", "OPENAI_TRANSLATION_MODEL")) {
  throw new Error("First-pass fact model default must be gpt-5.4");
}
if (!workflowEnvHasDefault("OPENAI_FACT_FALLBACK_MODEL", "gpt-5.4-mini", "OPENAI_TRANSLATION_FALLBACK_MODEL")) {
  throw new Error("Fact fallback default must be gpt-5.4-mini");
}

const stages = [
  "npm run collect",
  "node scripts/filter-regional-iraq-exposure.mjs",
  "node scripts/prepare-domestic-media.mjs",
  "node scripts/extract-article-facts.mjs",
  "node scripts/refine-report-writing.mjs",
  "npm run postprocess"
];
const positions = stages.map((stage) => workflow.indexOf(stage));
if (positions.some((value) => value < 0) || !positions.every((value, index) => index === 0 || value > positions[index - 1])) {
  throw new Error("Workflow stages are missing or out of order");
}

await fs.access(path.join(ROOT, "templates", "weekly-report-template.docx"));
await fs.access(path.join(ROOT, "scripts", "fill-weekly-template.py"));

const syntaxFiles = [
  "app.js",
  "scripts/editorial-rules.mjs",
  "scripts/article-fact-rules.mjs",
  "scripts/collect-sources-only.mjs",
  "scripts/collect-news.mjs",
  "scripts/filter-regional-iraq-exposure.mjs",
  "scripts/prepare-domestic-media.mjs",
  "scripts/extract-article-facts.mjs",
  "scripts/normalize-extracted-entities.mjs",
  "scripts/refine-report-writing.mjs",
  "scripts/postprocess-news.mjs",
  "scripts/generate-weekly-report.mjs",
  "scripts/validate-project.mjs",
  "scripts/validate-regional-iraq-scope.mjs",
  "scripts/apply-glossary-to-news.mjs",
  "scripts/fix-recursive-glossary-artifacts.mjs",
  "scripts/fix-known-political-summaries.mjs",
  "scripts/filter-untranslated-news.mjs",
  "scripts/fix-agency-dateline-location-errors.mjs",
  "scripts/filter-ai-hallucinated-actors.mjs",
  "scripts/filter-irrelevant-foreign-news.mjs",
  "scripts/filter-strict-relevance-and-facts.mjs",
  "scripts/filter-gaza-regional-news.mjs",
  "scripts/deduplicate-news-articles.mjs"
];
for (const file of syntaxFiles) {
  await fs.access(path.join(ROOT, file));
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Validated ${queries.length} queries, domestic-media separation, workflow models, and ${syntaxFiles.length} JavaScript files.`);
