#!/usr/bin/env node
/** Lightweight structural validation for the repository. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EDITORIAL_VERSION, editorialPromptBytes } from "./editorial-rules.mjs";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywordConfig = await readJson("data/search-keywords.json");
const queries = Object.entries(keywordConfig)
  .filter(([key]) => !key.startsWith("_"))
  .flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!queries.length) throw new Error("Search keyword list is empty");
if (new Set(queries).size !== queries.length) throw new Error("Duplicate search keywords found");
for (const required of ["\"العراق\" \"مجلس الوزراء\"", "\"العراق\" \"داعش\"", "\"국제유가\"", "\"중동 정세\" \"이란\" \"미국\""]) {
  if (!queries.includes(required)) throw new Error(`Required search keyword missing: ${required}`);
}
const forbiddenArabicEconomy = ["\"العراق\" \"النفط\"", "\"العراق\" \"الاقتصاد\"", "\"العراق\" \"الاستثمار\"", "\"العراق\" \"الإسكان\""];
for (const forbidden of forbiddenArabicEconomy) {
  if (queries.includes(forbidden)) throw new Error(`Arabic economy keyword must remain removed: ${forbidden}`);
}

const sources = await readJson("data/iraq-media-sources.json");
const sourceText = JSON.stringify(sources).toLowerCase();
if (sourceText.includes("ninanews.com") || sources.some((source) => String(source.id || "").toLowerCase() === "nina")) {
  throw new Error("NINA must remain excluded from configured sources");
}
const alJazeera = sources.find((source) => source.id === "aljazeera-arabic" && source.enabled !== false);
if (!alJazeera || !(alJazeera.listPages || []).some((url) => /aljazeera\.net\/where\/mideast\/arab\/iraq/i.test(url))) {
  throw new Error("Al Jazeera Arabic Iraq source is missing or disabled");
}
for (const required of ["\"علي الزيدي\"", "\"الزيدي\" \"طهران\""]) {
  if (!queries.includes(required)) throw new Error(`Current Iraqi PM search keyword missing: ${required}`);
}
await fs.access(path.join(ROOT, "templates", "weekly-report-template.docx"));
await fs.access(path.join(ROOT, "scripts", "fill-weekly-template.py"));

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
const scriptRefs = [...indexHtml.matchAll(/<script\s+src="\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
if (scriptRefs.length !== 1 || scriptRefs[0] !== "app.js") {
  throw new Error(`index.html must load only app.js; found: ${scriptRefs.join(", ")}`);
}

const appJs = await fs.readFile(path.join(ROOT, "app.js"), "utf8");
if ((appJs.match(/function buildWordHtml\s*\(/g) || []).length !== 1 || (appJs.match(/window\.buildWordHtml\s*=/g) || []).length !== 1) {
  throw new Error("app.js must expose exactly one buildWordHtml implementation");
}
if ((appJs.match(/new MutationObserver\s*\(/g) || []).length > 1) {
  throw new Error("app.js must not register multiple article-list observers");
}

const packageJson = await readJson("package.json");
if (packageJson.scripts?.collect !== "node scripts/collect-news.mjs") {
  throw new Error("npm run collect must execute the canonical collector directly");
}
try {
  await fs.access(path.join(ROOT, "scripts/run-report-style-collector.mjs"));
  throw new Error("Runtime collector patch wrapper must remain removed");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const workflow = await fs.readFile(path.join(ROOT, ".github/workflows/collect-news.yml"), "utf8");
if (/47 21 \* \* \*/.test(workflow)) throw new Error("Unconditional 06:47 backup schedule must remain removed");
const promptBytes = editorialPromptBytes();
if (promptBytes < 4000 || promptBytes > 7500) {
  throw new Error(`Collection prompt must remain within the 4-7.5KB budget; found ${promptBytes} bytes`);
}

const syntaxFiles = [
  "app.js",
  "scripts/editorial-rules.mjs",
  "scripts/collect-news.mjs",
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
console.log(`Validated ${queries.length} queries, ${sources.length} sources, ${syntaxFiles.length} JavaScript files, editorial policy ${EDITORIAL_VERSION} (${promptBytes} bytes).`);
