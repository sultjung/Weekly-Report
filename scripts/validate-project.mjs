#!/usr/bin/env node
/** Lightweight structural validation for the repository. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { EDITORIAL_VERSION, editorialPromptBytes } from "./editorial-rules.mjs";
import { FACT_EXTRACTION_VERSION, factExtractionPrompt, factPromptBytes } from "./article-fact-rules.mjs";
import { classifyArticle, evidenceQuoteSupported } from "./extract-article-facts.mjs";
import { roleFromEvidence, unambiguousLocationFromSource } from "./normalize-extracted-entities.mjs";
import { exclusionReason, applyDeterministicCorrections } from "./filter-strict-relevance-and-facts.mjs";

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
for (const forbidden of ["\"가자\" \"이스라엘\" \"인질\"", "\"Gaza\" \"Israel\" \"hostages\""]) {
  if (queries.includes(forbidden)) throw new Error(`Gaza-specific Middle East query must remain removed: ${forbidden}`);
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
for (const forbidden of [/function buildWordHtml\s*\(/, /application\/msword/, /\.doc["'`]/]) {
  if (forbidden.test(appJs)) throw new Error(`Browser-side fake Word generation must remain removed: ${forbidden}`);
}
if (!/generate-weekly-report\.yml/.test(appJs) || !/copySelectionJson/.test(appJs)) {
  throw new Error("Browser report action must copy selection JSON and open the canonical DOCX workflow");
}
if ((appJs.match(/new MutationObserver\s*\(/g) || []).length > 1) {
  throw new Error("app.js must not register multiple article-list observers");
}

const packageJson = await readJson("package.json");
if (packageJson.scripts?.collect !== "node scripts/collect-sources-only.mjs") {
  throw new Error("npm run collect must execute the AI-free source collector");
}
const sourceCollector = await fs.readFile(path.join(ROOT, "scripts/collect-sources-only.mjs"), "utf8");
if (!/OPENAI_API_KEY:\s*""/.test(sourceCollector) || !/scripts\/collect-news\.mjs/.test(sourceCollector)) {
  throw new Error("Source collector must clear OpenAI credentials before invoking collect-news.mjs");
}
try {
  await fs.access(path.join(ROOT, "scripts/run-report-style-collector.mjs"));
  throw new Error("Runtime collector patch wrapper must remain removed");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const workflow = await fs.readFile(path.join(ROOT, ".github/workflows/collect-news.yml"), "utf8");
if (/47 21 \* \* \*/.test(workflow)) throw new Error("Unconditional 06:47 backup schedule must remain removed");
if (/gpt-4o-mini/.test(workflow)) throw new Error("Collect workflow must not silently downgrade to gpt-4o-mini");
if (!/OPENAI_FACT_MODEL:\s*"gpt-5\.4"/.test(workflow)) throw new Error("First-pass fact model must be gpt-5.4");
if (/OPENAI_FACT_MODEL:\s*"gpt-5\.4-(?:mini|nano)"/.test(workflow)) throw new Error("First-pass fact model must not use a small-model tier");
if (!/OPENAI_FACT_FALLBACK_MODEL:\s*"gpt-5\.4-mini"/.test(workflow)) throw new Error("Fact fallback must remain gpt-5.4-mini");
if (/OPENAI_SUMMARY_MODEL|OPENAI_SUMMARY_FALLBACK_MODEL/.test(workflow)) throw new Error("Legacy all-in-one summary model must not run in the collection workflow");
const stageOrder = [
  workflow.indexOf("npm run collect"),
  workflow.indexOf("node scripts/extract-article-facts.mjs"),
  workflow.indexOf("node scripts/refine-report-writing.mjs"),
  workflow.indexOf("npm run postprocess")
];
if (stageOrder.some((value) => value < 0) || !stageOrder.every((value, index) => index === 0 || value > stageOrder[index - 1])) {
  throw new Error("Workflow stages must remain collect -> fact extraction -> report refinement -> postprocess");
}

const promptBytes = editorialPromptBytes();
if (promptBytes < 4000 || promptBytes > 7500) {
  throw new Error(`Editorial prompt must remain within the 4-7.5KB budget; found ${promptBytes} bytes`);
}
const factBytes = factPromptBytes();
if (factBytes < 1500 || factBytes > 4000) {
  throw new Error(`Fact extraction prompt must remain focused within 1.5-4KB; found ${factBytes} bytes`);
}
const factPrompt = factExtractionPrompt();
for (const forbidden of ["importanceScore", "reportBullet", "reportSubBullets", "reportImplication", "category3", "reportUsefulness"]) {
  if (factPrompt.includes(forbidden)) throw new Error(`Fact extraction prompt must not request ${forbidden}`);
}

function requireMatch(value, pattern, label) {
  if (!pattern.test(String(value || ""))) throw new Error(`Quality-gate regression failed: ${label}`);
}
function requireEmpty(value, label) {
  if (String(value || "") !== "") throw new Error(`Quality-gate regression failed: ${label} (${value})`);
}
function requireExcluded(result, pattern, label) {
  if (result?.include !== false || !pattern.test(String(result?.reason || ""))) throw new Error(`Fact-pipeline regression failed: ${label}`);
}
function requireCategory(result, category, label) {
  if (result?.include !== true || result?.category3 !== category) throw new Error(`Fact-pipeline regression failed: ${label}`);
}

requireExcluded(classifyArticle({
  collectionLane: "oil_market",
  title: "대구 휘발유값 11주 연속 하락…국제유가 급등",
  description: "대구 주유소 휘발유 가격 동향"
}), /휘발유/, "local retail fuel must be rejected before AI");
requireExcluded(classifyArticle({
  collectionLane: "arabic_iraq_direct",
  title: "ثاني أغرب عشاء لمراسلي البيت الأبيض",
  description: "عشاء في نيويورك وخطاب هجومي ضد الصحفيين"
}), /이라크/, "White House dinner must be rejected before AI");
requireExcluded(classifyArticle({
  collectionLane: "regional_context",
  title: "가자지구 공습 확대",
  description: "이스라엘과 하마스 충돌"
}), /가자/, "Gaza regional story must be rejected before AI");
requireCategory(classifyArticle({
  collectionLane: "arabic_iraq_security",
  title: "العراق يعلن اعتقال ثلاثة أشخاص في بغداد",
  description: "ضبط طائرات مسيرة"
}), "terror_security", "real Iraq security article must remain eligible");
requireCategory(classifyArticle({
  collectionLane: "core_bncp",
  title: "비스마야 신도시 사업 관련 한화 협의",
  description: "이라크 비스마야 사업"
}), "politics", "BNCP article must remain top priority");
if (!evidenceQuoteSupported("اعتقال ثلاثة أشخاص", {
  title: "العراق يعلن اعتقال ثلاثة أشخاص في بغداد",
  description: "ضبط طائرات مسيرة"
})) throw new Error("Evidence quote validator must accept exact source text");
if (evidenceQuoteSupported("Al-Zaidi 외무장관", {
  title: "رئيس الوزراء علي الزيدي يؤكد من طهران",
  description: "قال رئيس مجلس الوزراء علي الزيدي"
})) throw new Error("Evidence quote validator must reject invented translated role text");
if (roleFromEvidence("قال رئيس مجلس الوزراء علي الزيدي") !== "총리") throw new Error("Arabic prime-minister role must normalize to 총리");
if (roleFromEvidence("اجتمع وزير الخارجية العراقي") !== "외무장관") throw new Error("Arabic foreign-minister role must normalize to 외무장관");
if (unambiguousLocationFromSource({ title: "اجتماع في بغداد", description: "العراق" }) !== "Baghdad") throw new Error("Single source location must normalize to Baghdad");
if (unambiguousLocationFromSource({ title: "لقاء بغداد وطهران" }) !== "") throw new Error("Ambiguous multi-location article must not force one location");

requireMatch(exclusionReason({
  category3: "oil_economy",
  title: "대구 휘발유값 11주 연속 하락…국제유가 급등에 상승 전환 가능성",
  description: "대구 주유소 휘발유 가격 동향"
}), /국내 지역 휘발유/, "local retail fuel article must be excluded");
requireMatch(exclusionReason({
  category3: "terror_security",
  title: "ثاني أغرب عشاء لمراسلي البيت الأبيض",
  description: "عشاء في نيويورك وخطاب هجومي ضد الصحفيين"
}), /제3국/, "White House dinner must not become Iraq security news");
requireMatch(exclusionReason({
  category3: "terror_security",
  title: "هذا أخطر تحد سياسي في الهند يواجه مودي",
  description: "احتجاجات الطلاب في الهند"
}), /제3국/, "India politics must not become Iraq security news");
requireEmpty(exclusionReason({
  category3: "terror_security",
  title: "العراق: اعتقال ثلاثة أشخاص في بغداد",
  description: "أعلن جهاز الأمن الوطني العراقي اعتقال ثلاثة أشخاص وضبط طائرات مسيرة"
}), "real Iraq security article must remain eligible");

const correctedZaidi = applyDeterministicCorrections({
  title: "رئيس الوزراء علي الزيدي يؤكد من طهران",
  description: "قال رئيس مجلس الوزراء علي الزيدي إن العراق لن يسمح بتهديد إيران من أراضيه",
  titleKo: "이라크 외무장관 Al-Zaidi, 이란 위협 차단 강조",
  reportBullet: "M.D, Al-Zaidi 외무장관, 이란 내 위협 차단 의지 표명",
  actors: ["Al-Zaidi 외무장관"]
});
requireMatch(correctedZaidi.titleKo, /Al-Zaidi 총리/, "Al-Zaidi role must be corrected to prime minister");
if (/^M\s*[.·]?\s*D/i.test(correctedZaidi.reportBullet || "")) {
  throw new Error("Quality-gate regression failed: M.D placeholder must be removed");
}
requireMatch(correctedZaidi.reportBullet, /Al-Zaidi 총리/, "report bullet role correction");

const syntaxFiles = [
  "app.js",
  "scripts/editorial-rules.mjs",
  "scripts/article-fact-rules.mjs",
  "scripts/collect-sources-only.mjs",
  "scripts/collect-news.mjs",
  "scripts/extract-article-facts.mjs",
  "scripts/normalize-extracted-entities.mjs",
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
  "scripts/filter-strict-relevance-and-facts.mjs",
  "scripts/filter-gaza-regional-news.mjs",
  "scripts/deduplicate-news-articles.mjs"
];
for (const file of syntaxFiles) {
  await fs.access(path.join(ROOT, file));
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Validated ${queries.length} queries, ${sources.length} sources, ${syntaxFiles.length} JavaScript files, editorial policy ${EDITORIAL_VERSION} (${promptBytes} bytes), fact policy ${FACT_EXTRACTION_VERSION} (${factBytes} bytes).`);
