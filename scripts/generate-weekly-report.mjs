#!/usr/bin/env node
/**
 * Generate Iraq Weekly Situation Report DOCX from selected news only.
 */

import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from "docx";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const REPORTS_DIR = path.join(ROOT, "reports");
const GENERATED_DIR = path.join(REPORTS_DIR, "generated");
const SELECTED_FILE = path.join(DATA_DIR, "selected-news.json");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const REPORT_TIMEZONE = "Asia/Seoul";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const FINAL_REPORT_MODEL = process.env.OPENAI_FINAL_REPORT_MODEL || "gpt-5.4-mini";
const FINAL_REPORT_REASONING = process.env.OPENAI_FINAL_REPORT_REASONING || "medium";
const FINAL_REPORT_EVIDENCE_CHARS = Number(process.env.FINAL_REPORT_EVIDENCE_CHARS || 2500);
const REPORT_CATEGORIES = ["politics", "terror_security", "oil_economy", "regional"];

function dateFromYmd(ymd) { const [y, m, d] = String(ymd).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 0, 0, 0)); }
function toYmd(date) { return date.toISOString().slice(0, 10); }
function addDays(date, days) { const n = new Date(date); n.setUTCDate(n.getUTCDate() + days); return n; }
function kstToday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: REPORT_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const v = (type) => Number(parts.find((p) => p.type === type)?.value || 0); return new Date(Date.UTC(v("year"), v("month") - 1, v("day"), 0, 0, 0)); }
function koreanDate(date) { return `${date.getUTCFullYear()}. ${date.getUTCMonth() + 1}. ${date.getUTCDate()}.`; }
function shortLegacyDate(date) { return `΄${String(date.getUTCFullYear()).slice(2)}.${date.getUTCMonth() + 1}.${date.getUTCDate()}`; }
function fileDateName(date) { return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`; }
function monthDay(value) { const d = new Date(value); if (Number.isNaN(d.getTime())) return ""; return `${d.getUTCMonth() + 1}.${d.getUTCDate()}`; }
function normalizeText(value = "") { return String(value || "").replace(/\s+/g, " ").trim(); }
function stripFinalPeriod(text = "") { return normalizeText(text).replace(/[.。]+$/g, ""); }

function resolvePeriod() {
  const startEnv = process.env.REPORT_START_DATE || "";
  const endEnv = process.env.REPORT_END_DATE || "";
  const reportDateEnv = process.env.REPORT_DATE || "";
  if (startEnv && endEnv) {
    const start = dateFromYmd(startEnv);
    const end = dateFromYmd(endEnv);
    return { start, end, reportDate: reportDateEnv ? dateFromYmd(reportDateEnv) : addDays(end, 1) };
  }
  const today = reportDateEnv ? dateFromYmd(reportDateEnv) : kstToday();
  // default: previous Friday to Thursday, assuming report day Friday
  const end = addDays(today, -1);
  const start = addDays(end, -6);
  return { start, end, reportDate: today };
}

function titleForPeriod(period) { return `건설, 이라크 주간 종합 상황보고(${shortLegacyDate(period.start)} ~ ${shortLegacyDate(period.end)})`; }

async function readSelectedArticles() {
  const rawInput = process.env.SELECTION_JSON || process.env.SELECTED_NEWS_JSON || "";
  if (rawInput.trim()) {
    const parsed = JSON.parse(rawInput);
    return Array.isArray(parsed) ? parsed : (parsed.articles || []);
  }
  try {
    const parsed = JSON.parse(await fs.readFile(SELECTED_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed : (parsed.articles || []);
  } catch {}
  const all = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const selected = (all.articles || []).filter((item) => item.selected === true);
  return selected;
}

function parseJsonObject(text = "") {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function responseText(data = {}) {
  return data.output_text || (data.output || [])
    .flatMap((part) => part.content || [])
    .map((part) => part.text || "")
    .join("\n");
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
      importanceScore: Number(item.importanceScore || 0),
      title: item.title || "",
      titleKo: item.titleKo || "",
      summaryKo: item.summaryKo || "",
      reportBullet: item.reportBullet || "",
      reportSubBullets: Array.isArray(item.reportSubBullets) ? item.reportSubBullets.slice(0, 2) : [],
      reportImplication: item.reportImplication || "",
      evidence: String(item.cleanText || item.fullText || item.description || "").slice(0, FINAL_REPORT_EVIDENCE_CHARS)
    }));
}

function validateFinalEdit(parsed, inputItems) {
  if (!parsed || typeof parsed !== "object" || !parsed.sections || typeof parsed.sections !== "object") {
    throw new Error("최종 편집 응답에 sections가 없습니다");
  }
  const inputById = new Map(inputItems.map((item) => [item.id, item]));
  const seen = new Map();
  const sections = {};

  for (const category of REPORT_CATEGORIES) {
    const rawItems = Array.isArray(parsed.sections[category]) ? parsed.sections[category] : [];
    sections[category] = rawItems.map((item) => {
      const sourceArticleIds = [...new Set((Array.isArray(item.sourceArticleIds) ? item.sourceArticleIds : [])
        .map(String)
        .filter((id) => inputById.get(id)?.category3 === category))];
      const reportBullet = normalizeText(item.reportBullet);
      if (!sourceArticleIds.length || !reportBullet) throw new Error(`${category} 최종 문장에 기사 ID 또는 본문이 없습니다`);
      for (const id of sourceArticleIds) seen.set(id, (seen.get(id) || 0) + 1);
      return {
        sourceArticleIds,
        reportBullet,
        reportSubBullets: Array.isArray(item.reportSubBullets) ? item.reportSubBullets.map(normalizeText).filter(Boolean).slice(0, 2) : [],
        reportImplication: normalizeText(item.reportImplication)
      };
    });
  }

  for (const item of inputItems) {
    if (seen.get(item.id) !== 1) throw new Error(`기사 ID ${item.id}가 최종 편집 결과에서 누락되었거나 중복되었습니다`);
  }

  return {
    sections,
    groupImpacts: Array.isArray(parsed.groupImpacts) ? parsed.groupImpacts.map(normalizeText).filter(Boolean).slice(0, 2) : []
  };
}

async function editSelectedForFinalReport(selected = []) {
  const inputItems = finalEditorInput(selected);
  if (!OPENAI_API_KEY || !inputItems.length) {
    return { applied: false, reason: OPENAI_API_KEY ? "편집 대상 기사 없음" : "OPENAI_API_KEY 없음" };
  }

  const prompt = [
    "당신은 이라크 주간 종합상황보고서의 최종 편집자다.",
    "선택된 기사 전체를 한 번에 검토해 사람이 작성한 하나의 보고서처럼 문체와 흐름을 통일하라.",
    "새로운 사실·수치·인과관계·전망을 추가하지 말고 제공된 기사 근거 안에서만 작성하라.",
    "같은 사건을 다룬 기사들은 같은 category3 안에서 하나의 보고 항목으로 병합할 수 있다.",
    "병합하더라도 모든 입력 기사 id를 정확히 한 번씩 sourceArticleIds에 포함하라.",
    "기사의 category3를 다른 항목으로 이동하지 말라.",
    \"기관 주체는 제공된 evidence와 본문을 기준으로 확인하라. 'الإطار التنسيقي'는 이라크 시아조정기구(SCF)이며 이란 최고 의회·이란 의회·이라크 의회가 아니다. 'مجلس النواب'만 이라크 의회, 'مجلس الوزراء'만 국무회의/내각회의를 뜻한다.\",
    \"'الإطار التنسيقي ... لا حماية للمتورطين بالفساد' 기사에서는 시아조정기구(SCF)가 주체다. Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 SCF 지도자들이 방미 결과 및 국익 관련 합의 이행을 지지한 사실과, 사법기관 확인 부패 연루자에 대한 소속 불문 정치적 보호 배제 방침을 유지하라.\",
    \"원문에 없는 이란·이란 최고 의회·이란 의회·최고지도자를 추가하지 말라. 근거 없는 신뢰 회복·정치적 책임성 강화·영향 가능성 문장은 작성하지 말라.\",
    "기사 간 반복을 제거하고, 번역투·홍보성 표현·일반론·근거 없는 시사점을 삭제하라.",
    "문체는 짧고 단정적인 명사형 보고서 문체를 사용한다.",
    "reportBullet은 최종 주간보고서에 바로 넣을 수 있도록 핵심 내용을 보고서 형식으로 압축하라. 반드시 1문장일 필요는 없지만 불필요하게 길게 쓰지 말라.",
    "reportBullet은 M.D 형식의 날짜로 시작하고 주체·장소·행동·결과를 포함하라. 기사 제목을 그대로 번역하지 말라.",
    "이라크·비스마야·한화·NIC·치안·유가·물류와 직접 연결되는 경우에만 사업 또는 파급효과를 언급하라. 연결 근거가 없으면 일반적인 영향 가능성을 덧붙이지 말라.",
    "기사에 없는 원인·전망·피해·정치적 의미를 추가하지 말라. '~하였다', '~하고 있다', '주목된다', '가능성이 있다' 같은 해설형 표현을 피하고 짧고 단정적인 보고서 문체를 사용하라.",
    "reportBullet은 대체로 45~80자 내외를 유지하되, 핵심 사실을 전달하기 위해 필요한 경우 문장을 나누어 작성할 수 있다.",
    \"reportSubBullets는 '* ' 없이 0~2개이며 reportBullet을 반복하지 않는다. 구체적 근거가 있는 사실이 없으면 빈 배열로 둔다.\",
    "reportImplication은 구체적인 정치·안보·경제·BNCP 사업 영향이 근거로 확인될 때만 1문장, 아니면 빈 문자열로 둔다.",
    "기관·인명 표기는 NIC, 청렴위원회, 시아조정기구(SCF), 인민동원군(PMF), 혁명수비대(IRGC), Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리 기준을 따른다.",
    "groupImpacts는 그룹/건설에 미치는 구체적 영향만 0~2문장으로 작성하고 일반론이면 빈 배열로 둔다.",
    "반드시 JSON 객체만 출력하고 다음 구조를 정확히 사용하라:",
    '{"sections":{"politics":[{"sourceArticleIds":["id"],"reportBullet":"","reportSubBullets":[],"reportImplication":""}],"terror_security":[],"oil_economy":[],"regional":[]},"groupImpacts":[]}',
    "",
    JSON.stringify(inputItems, null, 2)
  ].join("\n");

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
          { role: "user", content: prompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const validated = validateFinalEdit(parseJsonObject(responseText(data)), inputItems);
    console.log(`[final-edit] applied articles=${inputItems.length}, model=${FINAL_REPORT_MODEL}, reasoning=${FINAL_REPORT_REASONING}`);
    return { applied: true, model: FINAL_REPORT_MODEL, reasoning: FINAL_REPORT_REASONING, ...validated };
  } catch (error) {
    console.warn(`[final-edit] failed; using existing report text: ${error.message || error}`);
    return { applied: false, model: FINAL_REPORT_MODEL, reasoning: FINAL_REPORT_REASONING, reason: String(error.message || error) };
  }
}

function hasCabinetOrCom(item = {}) {
  const text = [item.titleKo, item.title, item.summaryKo, item.reportBullet, item.weeklyReportReason].filter(Boolean).join(" ");
  return /내각회의|COM|Council of Ministers|مجلس الوزراء|국무회의/i.test(text);
}

function itemDateSort(a, b) { return new Date(a.publishedAt || a.date || 0) - new Date(b.publishedAt || b.date || 0); }
function byCategory(articles, cat) { return articles.filter((x) => x.category3 === cat).sort(itemDateSort); }

function humanizeTerms(text = "") {
  return String(text || "")
    .replace(/국가투자위원회/g, "NIC")
    .replace(/투자위원회/g, "NIC")
    .replace(/투자청장/g, "NIC 의장")
    .replace(/부패방지위원회/g, "청렴위원회")
    .replace(/조정프레임워크/g, "시아조정기구(SCF)")
    .replace(/바그다드/g, "Baghdad")
    .replace(/테헤란/g, "Teheran");
}

function reportMain(article) {
  let base = article.reportBullet || `${monthDay(article.publishedAt)}, ${article.titleKo || article.title || "주요 동향"}`;
  base = base.replace(/^[-·•\s]+/, "").trim();
  if (!/^\d{1,2}\.\d{1,2},/.test(base)) base = `${monthDay(article.publishedAt)}, ${base}`;
  return `- ${stripFinalPeriod(humanizeTerms(base))}.`;
}
function reportSubs(article) { return Array.isArray(article.reportSubBullets) ? article.reportSubBullets.map((x) => `* ${stripFinalPeriod(humanizeTerms(x))}.`).filter(Boolean).slice(0, 2) : []; }
function reportImplication(article) { return article.reportImplication ? `☞ ${stripFinalPeriod(humanizeTerms(article.reportImplication))}.` : ""; }
function toReportItems(articles) { return articles.map((article) => ({ main: reportMain(article), subs: reportSubs(article), implication: reportImplication(article), source: article.source, url: article.url, raw: article })); }

function finalSectionItems(finalEdit, category, selected = []) {
  if (!finalEdit?.applied) return toReportItems(byCategory(selected, category));
  const sourceById = new Map(finalEditorInput(selected).map((item) => [item.id, item]));
  return (finalEdit.sections?.[category] || []).map((item) => {
    const sources = item.sourceArticleIds.map((id) => sourceById.get(id)).filter(Boolean);
    const first = sources[0] || {};
    const article = {
      publishedAt: first.publishedAt,
      reportBullet: item.reportBullet,
      reportSubBullets: item.reportSubBullets,
      reportImplication: item.reportImplication
    };
    return {
      main: reportMain(article),
      subs: reportSubs(article),
      implication: reportImplication(article),
      source: [...new Set(sources.map((source) => source.source).filter(Boolean))].join(", "),
      url: first.url || "",
      raw: sources
    };
  });
}

async function fetchYahooDaily(symbol) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=7d&interval=1d`;
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 Iraq Weekly Report Builder" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const result = data.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    return timestamps.map((ts, i) => ({ date: new Date(ts * 1000), value: closes[i] })).filter((x) => Number.isFinite(x.value));
  } catch {
    return [];
  }
}

async function buildOilRows(period) {
  const d1 = addDays(period.reportDate, -2);
  const d2 = addDays(period.reportDate, -1);
  const targetDates = [toYmd(d1), toYmd(d2)];
  const [wti, brent] = await Promise.all([fetchYahooDaily("CL=F"), fetchYahooDaily("BZ=F")]);
  const pick = (rows, ymd) => {
    const exact = rows.find((x) => toYmd(x.date) === ymd);
    const prior = rows.filter((x) => toYmd(x.date) <= ymd).sort((a, b) => b.date - a.date)[0];
    return exact || prior;
  };
  return targetDates.map((ymd) => {
    const w = pick(wti, ymd);
    const b = pick(brent, ymd);
    return {
      date: `${Number(ymd.slice(5, 7))}.${Number(ymd.slice(8, 10))}`,
      dubai: "-",
      brent: b ? `$${b.value.toFixed(2)}` : "-",
      wti: w ? `$${w.value.toFixed(2)}` : "-"
    };
  });
}

const REPORT_LINE = { single: 240, relaxed: 276, table: 240 };
const INDENT = { level2: 567, category: 792, main: 1276, sub: 1450, impact: 792 };
function p(text = "", options = {}) {
  return new Paragraph({
    alignment: options.align || AlignmentType.LEFT,
    spacing: { before: options.before ?? 0, after: options.after ?? 0, line: options.line ?? REPORT_LINE.single },
    indent: options.indent ? { left: options.indent } : undefined,
    children: [new TextRun({ text: String(text || ""), bold: !!options.bold, italics: !!options.italics, size: options.size || 28, font: "Batang", underline: options.underline ? { type: "single" } : undefined })]
  });
}
function heading(text, level = 1) { return level === 1 ? p(text, { bold: true, size: 32, before: 220, after: 220 }) : p(text, { bold: true, size: 28, indent: INDENT.level2, before: 220, after: 140, line: REPORT_LINE.relaxed }); }
function categoryHeading(text) { return p(text, { bold: true, size: 28, indent: INDENT.category, before: 160, after: 120, line: REPORT_LINE.relaxed }); }
function itemParagraphs(items, empty = "- 특이사항 없음") {
  const out = [];
  if (!items.length) return [p(empty, { size: 28, indent: INDENT.main, after: 160 })];
  for (const item of items) {
    out.push(p(item.main, { size: 28, indent: INDENT.main, after: 80 }));
    for (const sub of item.subs || []) out.push(p(sub, { size: 28, indent: INDENT.sub, after: 70 }));
    if (item.implication) out.push(p(item.implication, { size: 28, indent: INDENT.sub, italics: true, after: 120 }));
    else out.push(p("", { size: 4, indent: INDENT.main, after: 25 }));
  }
  return out;
}
function borders() { return { top: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, bottom: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, left: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, right: { style: BorderStyle.SINGLE, size: 1, color: "333333" }, insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "777777" }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "777777" } }; }
function tc(text, options = {}) { return new TableCell({ width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined, shading: options.shading ? { fill: options.shading } : undefined, margins: { top: 45, bottom: 45, left: 70, right: 70 }, children: [p(text, { align: options.align || AlignmentType.CENTER, bold: options.bold, size: options.size || 22, after: 0, line: REPORT_LINE.table })] }); }
function tr(children) { return new TableRow({ children }); }
function terrorTable() { return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: borders(), rows: [tr(["구분", "계", "무장세력공격", "IED", "암 살", "시 위", "총 격", "자살폭탄테러"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))), tr(["건수", "확인 필요", "-", "-", "-", "-", "-", "-"].map((x) => tc(x)))] }); }
function oilTable(rows = []) { const safe = rows.length ? rows : [{ date: "-", dubai: "-", brent: "-", wti: "-" }]; return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: borders(), rows: [tr(["구 분", "두바이유", "브렌트유", "서부텍사스유(WTI)"].map((x) => tc(x, { bold: true, shading: "F2F2F2" }))), ...safe.map((row) => tr([tc(row.date || "-"), tc(row.dubai || "-"), tc(row.brent || "-"), tc(row.wti || "-")]))] }); }
function cabinetTableIfNeeded(articles = []) {
  const cabinetItems = articles.filter(hasCabinetOrCom);
  if (!cabinetItems.length) return [];
  const rows = cabinetItems.slice(0, 5).map((article, i) => tr([tc(String(i + 1), { width: 10 }), tc(article.titleKo || article.title || "내각회의", { width: 30 }), tc((article.reportSubBullets || [article.summaryKo || article.weeklyReportReason || "주요 의결사항 확인 필요"]).join("\n"), { width: 60, align: AlignmentType.LEFT })]));
  return [new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: borders(), rows: [tr([tc("구 분", { bold: true, shading: "F2F2F2", width: 10 }), tc("주 제", { bold: true, shading: "F2F2F2", width: 30 }), tc("내 용", { bold: true, shading: "F2F2F2", width: 60 })]), ...rows] }), p("", { after: 100 })];
}
function impactItems(selected = []) {
  const top = selected.slice().sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0)).slice(0, 6);
  const safety = top.find((x) => x.category3 === "terror_security" || x.category3 === "regional");
  const admin = top.find((x) => x.category3 === "politics" || x.category3 === "oil_economy");
  const out = [];
  if (safety) out.push(`• ${stripFinalPeriod(humanizeTerms(safety.reportImplication || safety.weeklyReportReason || "현장 이동·외부활동 관련 안전관리 강화 필요"))}.`);
  else out.push("• 이라크 치안 및 주변국 긴장 동향에 따른 현장 이동·외부활동 관리 지속 필요.");
  if (admin) out.push(`• ${stripFinalPeriod(humanizeTerms(admin.reportImplication || admin.weeklyReportReason || "투자·행정 의사결정 변화 가능성 점검 필요"))}.`);
  else out.push("• 정부·의회·투자기관 동향에 따른 인허가 및 사업 협의 일정 변동 가능성 점검 필요.");
  return out.slice(0, 2);
}

async function main() {
  const period = resolvePeriod();
  const selected = (await readSelectedArticles()).filter(Boolean);
  if (!selected.length) throw new Error("선택된 기사가 없습니다. selection_json 입력 또는 data/selected-news.json을 확인하세요.");
  selected.sort(itemDateSort);

  const finalEdit = await editSelectedForFinalReport(selected);
  const politics = finalSectionItems(finalEdit, "politics", selected);
  const security = finalSectionItems(finalEdit, "terror_security", selected);
  const economy = finalSectionItems(finalEdit, "oil_economy", selected);
  const regional = finalSectionItems(finalEdit, "regional", selected);
  const oilRows = await buildOilRows(period);
  const title = process.env.REPORT_TITLE || titleForPeriod(period);

  const children = [
    p(title, { bold: true, underline: true, size: 32, after: 90, line: REPORT_LINE.relaxed }),
    p(koreanDate(period.reportDate), { size: 28, align: AlignmentType.RIGHT, after: 260 }),
    heading("1. 이라크 국내 상황", 1),
    heading("1) 정국 / 치안", 2),
    categoryHeading("• 정치권 동향"),
    ...itemParagraphs(politics),
    ...cabinetTableIfNeeded(byCategory(selected, "politics")),
    categoryHeading("• 이라크 주간 테러 상황"),
    terrorTable(),
    p("", { after: 100 }),
    ...itemParagraphs(security),
    heading("2) 경제", 2),
    categoryHeading("• 국제유가 관련 동향"),
    ...itemParagraphs(economy),
    oilTable(oilRows),
    p("", { after: 100 }),
    heading("2. 국제사회", 1),
    categoryHeading("• 이라크와 관련 있는 주변국·국제정세"),
    ...itemParagraphs(regional),
    heading("3. 그룹 / 건설에 미치는 영향", 1),
    ...(finalEdit.applied && finalEdit.groupImpacts.length ? finalEdit.groupImpacts.map((x) => `• ${stripFinalPeriod(humanizeTerms(x))}.`) : impactItems(selected))
      .map((x) => p(x, { size: 28, indent: INDENT.impact, after: 100 }))
  ];

  const doc = new Document({
    styles: { default: { document: { run: { font: "Batang", size: 28 }, paragraph: { spacing: { line: REPORT_LINE.single } } } } },
    sections: [{ properties: { page: { margin: { top: 850, right: 900, bottom: 850, left: 900 } } }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: "Batang", size: 20 })] })] }) }, children }]
  });

  await fs.mkdir(GENERATED_DIR, { recursive: true });
  const buffer = await Packer.toBuffer(doc);
  const fileName = `건설_이라크 주간 종합상황보고(${fileDateName(period.reportDate)}).docx`;
  const generatedPath = path.join(GENERATED_DIR, fileName);
  await fs.writeFile(generatedPath, buffer);
  await fs.writeFile(path.join(REPORTS_DIR, "latest.docx"), buffer);
  const finalEditing = { applied: finalEdit.applied, model: finalEdit.model || "none", reasoning: finalEdit.reasoning || "none", reason: finalEdit.reason || "" };
  const meta = { generatedAt: new Date().toISOString(), title, periodStart: toYmd(period.start), periodEnd: toYmd(period.end), reportDate: toYmd(period.reportDate), selectedCount: selected.length, file: `reports/generated/${fileName}`, latest: "reports/latest.docx", oilRows, finalEditing };
  await fs.writeFile(path.join(REPORTS_DIR, "latest.json"), JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(path.join(GENERATED_DIR, fileName.replace(/\.docx$/i, ".json")), JSON.stringify({ meta, selected, finalReport: finalEdit.applied ? { sections: finalEdit.sections, groupImpacts: finalEdit.groupImpacts } : null }, null, 2), "utf8");
  console.log("Weekly report generated:", meta);
}

main().catch((err) => { console.error(err); process.exit(1); });
