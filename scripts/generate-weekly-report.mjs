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

  const politics = toReportItems(byCategory(selected, "politics"));
  const security = toReportItems(byCategory(selected, "terror_security"));
  const economy = toReportItems(byCategory(selected, "oil_economy"));
  const regional = toReportItems(byCategory(selected, "regional"));
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
    ...impactItems(selected).map((x) => p(x, { size: 28, indent: INDENT.impact, after: 100 }))
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
  const meta = { generatedAt: new Date().toISOString(), title, periodStart: toYmd(period.start), periodEnd: toYmd(period.end), reportDate: toYmd(period.reportDate), selectedCount: selected.length, file: `reports/generated/${fileName}`, latest: "reports/latest.docx", oilRows };
  await fs.writeFile(path.join(REPORTS_DIR, "latest.json"), JSON.stringify(meta, null, 2), "utf8");
  await fs.writeFile(path.join(GENERATED_DIR, fileName.replace(/\.docx$/i, ".json")), JSON.stringify({ meta, selected }, null, 2), "utf8");
  console.log("Weekly report generated:", meta);
}

main().catch((err) => { console.error(err); process.exit(1); });
