#!/usr/bin/env node
/**
 * Generate the Iraq weekly report by filling the approved final-report DOCX.
 * AI edits content only; Word layout is owned by the template.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { finalReportPrompt } from "./editorial-rules.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const REPORTS_DIR = path.join(ROOT, "reports");
const GENERATED_DIR = path.join(REPORTS_DIR, "generated");
const TEMPLATE_FILE = path.join(ROOT, "templates", "weekly-report-template.docx");
const FILL_SCRIPT = path.join(ROOT, "scripts", "fill-weekly-template.py");
const SELECTED_FILE = path.join(DATA_DIR, "selected-news.json");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const REPORT_TIMEZONE = "Asia/Seoul";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const FINAL_REPORT_MODEL = process.env.OPENAI_FINAL_REPORT_MODEL || "gpt-5.4-mini";
const FINAL_REPORT_REASONING = process.env.OPENAI_FINAL_REPORT_REASONING || "medium";
const FINAL_REPORT_EVIDENCE_CHARS = Number(process.env.FINAL_REPORT_EVIDENCE_CHARS || 2500);
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";
const REPORT_CATEGORIES = ["politics", "terror_security", "oil_economy", "regional"];

function dateFromYmd(ymd) { const [y, m, d] = String(ymd).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function toYmd(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function kstToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
}
function koreanDate(date) { return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`; }
function shortLegacyDate(date) { return `΄${String(date.getUTCFullYear()).slice(2)}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`; }
function fileDateName(date) { return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`; }
function monthDay(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : `${date.getUTCMonth() + 1}.${date.getUTCDate()}`; }
function normalizeText(value = "") { return String(value || "").replace(/\s+/g, " ").trim(); }
function stripFinalPeriod(value = "") { return normalizeText(value).replace(/[.。]+$/g, ""); }
function numeric(value, fallback = 0) { const number = Number(value); return Number.isFinite(number) ? number : fallback; }
function isWithinPeriod(item, period) {
  const published = new Date(item.publishedAt || item.date || "");
  return !Number.isNaN(published.getTime()) && published >= period.start && published < addDays(period.end, 1);
}

function resolvePeriod() {
  const startEnv = process.env.REPORT_START_DATE || "";
  const endEnv = process.env.REPORT_END_DATE || "";
  const reportDateEnv = process.env.REPORT_DATE || "";
  if (startEnv && endEnv) {
    const start = dateFromYmd(startEnv);
    const end = dateFromYmd(endEnv);
    return { start, end, reportDate: reportDateEnv ? dateFromYmd(reportDateEnv) : addDays(end, 1) };
  }
  const reportDate = reportDateEnv ? dateFromYmd(reportDateEnv) : kstToday();
  const end = addDays(reportDate, -1);
  return { start: addDays(end, -6), end, reportDate };
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; }
}

async function readSelectedArticles() {
  const rawInput = process.env.SELECTION_JSON || process.env.SELECTED_NEWS_JSON || "";
  if (rawInput.trim()) {
    const parsed = JSON.parse(rawInput);
    return Array.isArray(parsed) ? parsed : (parsed.articles || []);
  }
  const selectedPayload = await readJson(SELECTED_FILE, null);
  if (selectedPayload) return Array.isArray(selectedPayload) ? selectedPayload : (selectedPayload.articles || []);
  const all = await readJson(NEWS_FILE, { articles: [] });
  return (all.articles || []).filter((item) => item.selected === true);
}

async function readAllArticles() {
  const payload = await readJson(NEWS_FILE, { articles: [] });
  return Array.isArray(payload) ? payload : (payload.articles || []);
}

function collapseSelectedEvents(articles = []) {
  const groups = new Map();
  for (const article of articles) {
    const key = article.eventId || `article:${article.id || article.url || article.titleKo || article.title}`;
    const current = groups.get(key);
    if (!current) {
      groups.set(key, article);
      continue;
    }
    const currentScore = numeric(current.importanceScore) + String(current.cleanText || current.fullText || "").length / 1000;
    const nextScore = numeric(article.importanceScore) + String(article.cleanText || article.fullText || "").length / 1000;
    if (nextScore > currentScore) groups.set(key, article);
  }
  return [...groups.values()];
}

function automaticReportCandidates(articles, period) {
  const limits = { oil_economy: 6, regional: 10 };
  const output = [];
  for (const category of Object.keys(limits)) {
    const candidates = collapseSelectedEvents(
      articles
        .filter((item) => item && isWithinPeriod(item, period))
        .filter((item) => item.category3 === category && item.reportUsefulness === "include")
        .filter((item) => category !== "oil_economy" || item.collectionLane === "oil_market")
        .filter((item) => category !== "regional" || item.collectionLane === "regional_context")
        .sort((a, b) => numeric(b.importanceScore) - numeric(a.importanceScore))
    ).slice(0, limits[category]);
    output.push(...candidates);
  }
  return output;
}

function parseJsonObject(text = "") {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function responseText(data = {}) {
  return data.output_text || (data.output || []).flatMap((part) => part.content || []).map((part) => part.text || "").join("\n");
}

function finalEditorInput(selected = []) {
  return selected
    .filter((item) => REPORT_CATEGORIES.includes(item.category3))
    .map((item, index) => ({
      id: `selected-${index + 1}`,
      sourceId: String(item.id || ""),
      publishedAt: item.publishedAt || item.date || "",
      source: item.source || "",
      url: item.url || "",
      category3: item.category3,
      collectionLane: item.collectionLane || "",
      importanceScore: numeric(item.importanceScore),
      title: item.title || "",
      titleKo: item.titleKo || "",
      summaryKo: item.summaryKo || "",
      reportBullet: item.reportBullet || "",
      reportSubBullets: Array.isArray(item.reportSubBullets) ? item.reportSubBullets.slice(0, 5) : [],
      reportImplication: item.reportImplication || "",
      eventId: item.eventId || "",
      eventSources: (item.eventSources || []).map((source) => ({ source: source.source || "", url: source.url || "", titleKo: source.titleKo || "", summaryKo: source.summaryKo || "" })),
      evidence: [String(item.cleanText || item.fullText || item.description || ""), ...(item.eventArticles || []).map((source) => `${source.source || ""}: ${source.titleKo || source.title || ""}. ${source.summaryKo || ""}. ${source.evidence || ""}`)].join("\n").slice(0, FINAL_REPORT_EVIDENCE_CHARS * 2)
    }));
}

function validateFinalEdit(parsed, inputItems) {
  if (!parsed?.sections || typeof parsed.sections !== "object") throw new Error("최종 편집 응답에 sections가 없습니다");
  const inputById = new Map(inputItems.map((item) => [item.id, item]));
  const seen = new Map();
  const sections = {};
  for (const category of REPORT_CATEGORIES) {
    sections[category] = (Array.isArray(parsed.sections[category]) ? parsed.sections[category] : []).map((item) => {
      const sourceArticleIds = [...new Set((Array.isArray(item.sourceArticleIds) ? item.sourceArticleIds : []).map(String).filter((id) => inputById.get(id)?.category3 === category))];
      const reportBullet = normalizeText(item.reportBullet);
      if (!sourceArticleIds.length || !reportBullet) throw new Error(`${category} 최종 문장에 기사 ID 또는 본문이 없습니다`);
      for (const id of sourceArticleIds) seen.set(id, (seen.get(id) || 0) + 1);
      return {
        sourceArticleIds,
        reportBullet,
        reportSubBullets: (Array.isArray(item.reportSubBullets) ? item.reportSubBullets : []).map(normalizeText).filter(Boolean).slice(0, 5),
        reportImplication: normalizeText(item.reportImplication)
      };
    });
  }
  for (const item of inputItems) {
    if (seen.get(item.id) !== 1) throw new Error(`기사 ID ${item.id}가 최종 편집 결과에서 누락되었거나 중복되었습니다`);
  }
  return {
    sections,
    internationalTopic: normalizeText(parsed.internationalTopic || "중동 주요 정세").slice(0, 40),
    groupImpacts: (Array.isArray(parsed.groupImpacts) ? parsed.groupImpacts : []).map(normalizeText).filter(Boolean).slice(0, 2)
  };
}

async function editSelectedForFinalReport(selected = []) {
  const inputItems = finalEditorInput(selected);
  if (!OPENAI_API_KEY || !inputItems.length) return { applied: false, reason: OPENAI_API_KEY ? "편집 대상 기사 없음" : "OPENAI_API_KEY 없음" };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: FINAL_REPORT_MODEL,
        reasoning: { effort: FINAL_REPORT_REASONING },
        text: { verbosity: "low" },
        input: [
          { role: "system", content: "Edit evidence-grounded Korean executive reports. Output valid JSON only." },
          { role: "user", content: finalReportPrompt(inputItems) }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    const validated = validateFinalEdit(parseJsonObject(responseText(await response.json())), inputItems);
    return { applied: true, model: FINAL_REPORT_MODEL, reasoning: FINAL_REPORT_REASONING, ...validated };
  } catch (error) {
    console.warn(`[final-edit] failed; using existing report text: ${error.message || error}`);
    return { applied: false, model: FINAL_REPORT_MODEL, reasoning: FINAL_REPORT_REASONING, reason: String(error.message || error) };
  }
}

function itemDateSort(a, b) { return new Date(a.publishedAt || a.date || 0) - new Date(b.publishedAt || b.date || 0); }
function byCategory(articles, category) { return articles.filter((item) => item.category3 === category).sort(itemDateSort); }
function humanizeTerms(value = "") {
  return String(value || "")
    .replace(/국가투자위원회/g, "NIC")
    .replace(/투자위원회/g, "NIC")
    .replace(/투자청장/g, "NIC 의장")
    .replace(/부패방지위원회/g, "청렴위원회")
    .replace(/조정프레임워크/g, "시아조정기구(SCF)")
    .replace(/바그다드/g, "Baghdad")
    .replace(/테헤란/g, "Teheran");
}
function reportMain(article) {
  let text = article.reportBullet || `${monthDay(article.publishedAt)}, ${article.titleKo || article.title || "주요 동향"}`;
  text = normalizeText(text).replace(/^[-·•\s]+/, "");
  if (!/^\d{1,2}\.\d{1,2}(?:~\d{1,2})?,/.test(text)) text = `${monthDay(article.publishedAt)}, ${text}`;
  return stripFinalPeriod(humanizeTerms(text));
}
function reportSubs(article) { return (Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []).map((value) => stripFinalPeriod(humanizeTerms(value))).filter(Boolean).slice(0, 5); }
function reportImplication(article) { return article.reportImplication ? stripFinalPeriod(humanizeTerms(article.reportImplication)) : ""; }
function toReportItems(articles) { return articles.map((article) => ({ main: reportMain(article), subs: reportSubs(article), implication: reportImplication(article) })); }

function finalSectionItems(finalEdit, category, selected) {
  if (!finalEdit.applied) return toReportItems(byCategory(selected, category));
  const sourceById = new Map(finalEditorInput(selected).map((item) => [item.id, item]));
  return (finalEdit.sections?.[category] || []).map((item) => {
    const first = sourceById.get(item.sourceArticleIds[0]) || {};
    return {
      main: reportMain({ publishedAt: first.publishedAt, reportBullet: item.reportBullet }),
      subs: item.reportSubBullets.map((value) => stripFinalPeriod(humanizeTerms(value))),
      implication: item.reportImplication ? stripFinalPeriod(humanizeTerms(item.reportImplication)) : ""
    };
  });
}

function oilRequestBody(start, end) {
  const body = new URLSearchParams({
    TERM: "D",
    STA_Y: String(start.getUTCFullYear()),
    STA_M: String(start.getUTCMonth() + 1).padStart(2, "0"),
    STA_D: String(start.getUTCDate()).padStart(2, "0"),
    END_Y: String(end.getUTCFullYear()),
    END_M: String(end.getUTCMonth() + 1).padStart(2, "0"),
    END_D: String(end.getUTCDate()).padStart(2, "0"),
    OILSRTCD1: "001",
    OILSRTCD2: "002",
    OILSRTCD3: "003",
    STDDATE: toYmd(start).replaceAll("-", ""),
    ENDDATE: toYmd(end).replaceAll("-", ""),
    SEL_DIV: "div_dar"
  });
  for (const code of ["001", "002", "003"]) body.append("OILSRTCD", code);
  return body;
}

function stripHtml(value = "") { return String(value).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
function parseOpinetOilRows(html = "") {
  const tbody = String(html).match(/<tbody[^>]+id=["']tbody2["'][^>]*>([\s\S]*?)<\/tbody>/i)?.[1] || "";
  const rows = [];
  for (const row of tbody.match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripHtml(match[1]));
    const dateMatch = cells[0]?.match(/(\d{2})년(\d{2})월(\d{2})일/);
    if (!dateMatch || cells.length < 4) continue;
    const date = `20${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
    const values = cells.slice(1, 4).map(Number);
    if (values.every(Number.isFinite)) rows.push({ ymd: date, date: `${Number(dateMatch[2])}.${Number(dateMatch[3])}`, dubai: `$${values[0].toFixed(2)}`, brent: `$${values[1].toFixed(2)}`, wti: `$${values[2].toFixed(2)}` });
  }
  return rows;
}

async function fetchYahooDaily(symbol) {
  try {
    const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=7d&interval=1d`, { headers: { "user-agent": "Mozilla/5.0 Iraq Weekly Report Builder" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = (await response.json()).chart?.result?.[0];
    return (result?.timestamp || []).map((timestamp, index) => ({ ymd: toYmd(new Date(timestamp * 1000)), value: result?.indicators?.quote?.[0]?.close?.[index] })).filter((item) => Number.isFinite(item.value));
  } catch { return []; }
}

async function buildOilRows(period) {
  const start = addDays(period.reportDate, -2);
  const end = addDays(period.reportDate, -1);
  const targets = [toYmd(start), toYmd(end)];
  try {
    const response = await fetch("https://www.opinet.co.kr/gloptotSelect.do", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": "Mozilla/5.0 Iraq Weekly Report Builder" },
      body: oilRequestBody(start, end)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = parseOpinetOilRows(await response.text());
    if (targets.every((ymd) => rows.some((row) => row.ymd === ymd))) return targets.map((ymd) => rows.find((row) => row.ymd === ymd));
    throw new Error(`requested dates missing: ${targets.join(", ")}`);
  } catch (error) {
    console.warn(`[oil] Opinet failed; Dubai unavailable and Yahoo fallback used: ${error.message || error}`);
    const [wti, brent] = await Promise.all([fetchYahooDaily("CL=F"), fetchYahooDaily("BZ=F")]);
    const pick = (rows, ymd) => rows.find((row) => row.ymd === ymd) || rows.filter((row) => row.ymd <= ymd).at(-1);
    return targets.map((ymd) => {
      const w = pick(wti, ymd);
      const b = pick(brent, ymd);
      return { date: `${Number(ymd.slice(5, 7))}.${Number(ymd.slice(8, 10))}`, dubai: "-", brent: b ? `$${b.value.toFixed(2)}` : "-", wti: w ? `$${w.value.toFixed(2)}` : "-" };
    });
  }
}

function inferSecurityType(article = {}) {
  const allowed = new Set(["armed_attack", "ied", "assassination", "protest", "shooting", "suicide_bombing"]);
  if (allowed.has(article.securityEventType)) return article.securityEventType;
  const text = [article.title, article.titleKo, article.summaryKo, article.reportBullet].filter(Boolean).join(" ");
  if (/تظاهرات|احتجاجات|اعتصام|protest|demonstration|시위|집회/i.test(text)) return "protest";
  if (/عبوة ناسفة|\bied\b|급조폭발물/i.test(text)) return "ied";
  if (/انتحاري|suicide bomb|자살폭탄/i.test(text)) return "suicide_bombing";
  if (/اغتيال|assassination|암살/i.test(text)) return "assassination";
  if (/إطلاق نار|shooting|총격/i.test(text)) return "shooting";
  return "armed_attack";
}

function buildTerrorStats(articles, period) {
  const stats = { total: 0, armed_attack: 0, ied: 0, assassination: 0, protest: 0, shooting: 0, suicide_bombing: 0 };
  const events = new Map();
  for (const article of articles) {
    if (article.category3 !== "terror_security" || article.reportUsefulness === "exclude") continue;
    if (!["arabic_iraq_security", "arabic_iraq_direct"].includes(String(article.collectionLane || ""))) continue;
    const published = new Date(article.publishedAt || article.date || "");
    if (Number.isNaN(published.getTime()) || published < period.start || published >= addDays(period.end, 1)) continue;
    const key = article.eventId || article.url || article.id || `${article.titleKo || article.title}:${toYmd(published)}`;
    const current = events.get(key);
    if (!current || numeric(article.importanceScore) > numeric(current.importanceScore)) events.set(key, article);
  }
  for (const article of events.values()) {
    const type = inferSecurityType(article);
    const count = Math.max(1, Math.min(100, Math.round(numeric(article.securityEventCount, 1))));
    stats[type] += count;
    stats.total += count;
  }
  return stats;
}

function impactItems(selected) {
  const top = selected.slice().sort((a, b) => numeric(b.importanceScore) - numeric(a.importanceScore)).slice(0, 8);
  const safety = top.find((item) => item.category3 === "terror_security" || item.category3 === "regional");
  const admin = top.find((item) => item.category3 === "politics");
  return [
    stripFinalPeriod(humanizeTerms(safety?.reportImplication || safety?.weeklyReportReason || "중동 및 이라크 치안 변화에 따른 임직원 외부 활동 사전 위협평가와 즉각 대응체계 유지")),
    stripFinalPeriod(humanizeTerms(admin?.reportImplication || admin?.weeklyReportReason || "이라크 정부·의회·NIC 동향에 따른 사업 협의 및 행정 일정 변동 여부 지속 점검"))
  ];
}

async function main() {
  const period = resolvePeriod();
  const allArticles = await readAllArticles();
  const manualSelected = (await readSelectedArticles()).filter((item) => item && isWithinPeriod(item, period));
  const selected = collapseSelectedEvents([...manualSelected, ...automaticReportCandidates(allArticles, period)]).sort(itemDateSort);
  if (!selected.length) throw new Error("보고기간 내 선택 기사 또는 자동 국제유가·중동 정세 후보가 없습니다.");
  const finalEdit = await editSelectedForFinalReport(selected);
  const oilRows = await buildOilRows(period);
  const reportData = {
    period: `${shortLegacyDate(period.start)} ~ ${shortLegacyDate(period.end)}`,
    reportDate: koreanDate(period.reportDate),
    internationalTopic: finalEdit.applied ? finalEdit.internationalTopic : "중동 주요 정세",
    sections: Object.fromEntries(REPORT_CATEGORIES.map((category) => [category, finalSectionItems(finalEdit, category, selected)])),
    groupImpacts: finalEdit.applied && finalEdit.groupImpacts.length ? finalEdit.groupImpacts : impactItems(selected),
    terrorStats: buildTerrorStats(allArticles, period),
    oilRows
  };

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const fileName = `건설_이라크 주간 종합상황보고(${fileDateName(period.reportDate)}).docx`;
  const generatedPath = path.join(GENERATED_DIR, fileName);
  const latestPath = path.join(REPORTS_DIR, "latest.docx");
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "weekly-report-"));
  const dataFile = path.join(tempDir, "report-data.json");
  await fs.writeFile(dataFile, JSON.stringify(reportData, null, 2), "utf8");
  const filled = spawnSync(PYTHON_BIN, [FILL_SCRIPT, "--template", TEMPLATE_FILE, "--data", dataFile, "--output", generatedPath, "--latest", latestPath], { stdio: "inherit" });
  await fs.rm(tempDir, { recursive: true, force: true });
  if (filled.status !== 0) throw new Error(`DOCX template fill failed with exit code ${filled.status}`);

  const finalEditing = { applied: finalEdit.applied, model: finalEdit.model || "none", reasoning: finalEdit.reasoning || "none", reason: finalEdit.reason || "" };
  const meta = {
    generatedAt: new Date().toISOString(),
    title: `건설, 이라크 주간 종합 상황보고(${reportData.period})`,
    periodStart: toYmd(period.start),
    periodEnd: toYmd(period.end),
    reportDate: toYmd(period.reportDate),
    selectedCount: selected.length,
    file: `reports/generated/${fileName}`,
    latest: "reports/latest.docx",
    template: "templates/weekly-report-template.docx",
    oilSource: "한국석유공사 오피넷 국제원유 일간가격",
    oilRows,
    terrorStats: reportData.terrorStats,
    finalEditing
  };
  await fs.writeFile(path.join(REPORTS_DIR, "latest.json"), JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(path.join(GENERATED_DIR, fileName.replace(/\.docx$/i, ".json")), JSON.stringify({ meta, selected, finalReport: reportData }, null, 2), "utf8");
  console.log("Weekly report generated:", meta);
}

main().catch((error) => { console.error(error); process.exit(1); });
