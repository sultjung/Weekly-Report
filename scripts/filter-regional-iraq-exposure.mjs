#!/usr/bin/env node
/**
 * Keep regional-context articles only when the source itself shows a direct
 * operational connection to Iraq or BNCP. Neighbouring-country security news
 * is not sufficient by itself.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const IRAQ_DIRECT_RE = /العراق|عراقي|العراقية|بغداد|البصرة|أربيل|اربيل|كركوك|الأنبار|الانبار|ديالى|الموصل|نينوى|إقليم كردستان|اقليم كردستان|iraq|iraqi|baghdad|basra|erbil|kirkuk|anbar|diyala|mosul|nineveh|iraqi kurdistan|kurdistan region of iraq|이라크|바그다드|바스라|에르빌|아르빌|키르쿠크|안바르|디얄라|모술|니나와|쿠르드 자치정부/iu;
const BISMAYAH_RE = /بسماية|بسمايه|بسمایه|bismayah|bismaya|bncp|비스마야/iu;
const HANWHA_RE = /شركة هانوا|هانوا|hanwha|한화/iu;
const NEGATED_RELEVANCE_RE = /(?:unrelated|not\s+(?:directly\s+)?related|no\s+(?:direct\s+)?connection|without\s+(?:an?\s+)?(?:iraq|bismayah|bncp)\s+connection).{0,45}(?:iraq|iraqi|bismayah|bismaya|bncp|hanwha)|(?:iraq|iraqi|bismayah|bismaya|bncp|hanwha).{0,45}(?:unrelated|not\s+(?:directly\s+)?related|no\s+(?:direct\s+)?connection)|(?:이라크|비스마야|한화).{0,30}(?:무관|관련\s*없|직접\s*연계\s*없)|(?:무관|관련\s*없|직접\s*연계\s*없).{0,30}(?:이라크|비스마야|한화)|(?:غير\s+مرتبط|لا\s+علاقة|ليس\s+له\s+علاقة).{0,40}(?:العراق|بسماية|هانوا)|(?:العراق|بسماية|هانوا).{0,40}(?:غير\s+مرتبط|لا\s+علاقة|ليس\s+له\s+علاقة)/iu;

const BORDER_RE = /الحدود|معبر حدودي|منفذ حدودي|إغلاق الحدود|غلق الحدود|تسلل|تهريب|لاجئ|نازح|انتشار حدودي|border|border crossing|cross-border|frontier|closure|closed crossing|infiltration|smuggling|refugee|displaced|border deployment|국경|국경검문소|국경 통제|국경 폐쇄|월경|침투|밀수|난민|피란민/iu;
const AIR_RE = /المجال الجوي|إغلاق الأجواء|المطار|الرحلات الجوية|تعليق الرحلات|إلغاء الرحلات|نوتام|airspace|airport|flight suspension|flight cancellation|aviation|notam|영공|공항|항공편|운항 중단|결항|비행금지/iu;
const IRAQ_BASE_RE = /قاعدة عين الأسد|عين الاسد|قاعدة حرير|القواعد الأمريكية في العراق|السفارة الأمريكية في بغداد|ain al-asad|al asad air base|harir base|us bases in iraq|us embassy in baghdad|이라크 미군기지|아인 알아사드|하리르 기지|주이라크 미국대사관/iu;
const IRAQ_SPECIFIC_ENERGY_RE = /صادرات النفط العراقية|موانئ البصرة|ميناء أم قصر|خور الزبير|ناقلات النفط العراقية|سلسلة التوريد إلى العراق|iraqi oil exports|basra ports?|umm qasr|khor al-zubair|iraqi tanker|supply chain to iraq|이라크 원유 수출|바스라항|움카스르|코르 알주바이르|이라크 유조선|이라크 공급망/iu;
const GENERAL_ENERGY_LOGISTICS_RE = /مضيق هرمز|البحر الأحمر|ناقلات النفط|الملاحة|الشحن|سلسلة التوريد|hormuz|red sea|oil tanker|shipping|navigation|supply chain|호르무즈|홍해|유조선|해운|항행|공급망/iu;
const EVACUATION_RE = /إجلاء|خطة الإخلاء|تحذير السفر|إغلاق السفارة|evacuation|evacuation flight|travel warning|embassy closure|대피|철수 계획|여행경보|대사관 폐쇄/iu;

function articleFields(article = {}) {
  const title = String(article.title || "");
  const description = String(article.description || "");
  const body = String(article.cleanText || article.fullText || "").slice(0, 12000);
  return { title, description, body };
}

function articleSourceText(article = {}) {
  const { title, description, body } = articleFields(article);
  return [title, description, body].filter(Boolean).join("\n");
}

function sourceSegments(article = {}) {
  const { title, description, body } = articleFields(article);
  const bodySegments = body
    .split(/\n+|(?<=[.!?؟。])\s+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  return [title, description, ...bodySegments]
    .filter(Boolean)
    .map((value) => value.slice(0, 1200));
}

function segmentHasPositiveIraqSignal(segment = "") {
  return IRAQ_DIRECT_RE.test(segment) && !NEGATED_RELEVANCE_RE.test(segment);
}

function hasLinkedIraqSignal(article = {}, signalRe) {
  return sourceSegments(article).some((segment) => segmentHasPositiveIraqSignal(segment) && signalRe.test(segment));
}

export function regionalIraqExposureReason(article = {}) {
  const raw = articleSourceText(article);
  if (!raw.trim()) return "원문 근거 없음";
  if (NEGATED_RELEVANCE_RE.test(raw)) return "원문이 이라크·비스마야 직접 관련성을 부정함";
  if (BISMAYAH_RE.test(raw) || (HANWHA_RE.test(raw) && IRAQ_DIRECT_RE.test(raw))) return "비스마야·한화 직접 관련";
  if (!IRAQ_DIRECT_RE.test(raw)) return "원문에 이라크 직접 연결 없음";
  if (hasLinkedIraqSignal(article, BORDER_RE)) return "이라크 국경·통관·침투 리스크";
  if (hasLinkedIraqSignal(article, AIR_RE)) return "이라크 영공·공항·항공편 리스크";
  if (IRAQ_BASE_RE.test(raw)) return "이라크 내 미군기지·외교시설 리스크";
  if (IRAQ_SPECIFIC_ENERGY_RE.test(raw) || hasLinkedIraqSignal(article, GENERAL_ENERGY_LOGISTICS_RE)) return "이라크 원유수출·항만·공급망 리스크";
  if (hasLinkedIraqSignal(article, EVACUATION_RE)) return "이라크 대피·이동·여행 리스크";
  return "비스마야 운영에 연결되는 국경·영공·공항·기지·물류 근거 부족";
}

export function isRegionalIraqExposure(article = {}) {
  const reason = regionalIraqExposureReason(article);
  return !/없음|부족$|부정함$/.test(reason);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const input = Array.isArray(payload.articles) ? payload.articles : [];
  const kept = [];
  const removed = [];

  for (const article of input) {
    if (article.collectionLane !== "regional_context") {
      kept.push(article);
      continue;
    }
    const reason = regionalIraqExposureReason(article);
    if (isRegionalIraqExposure(article)) {
      kept.push({ ...article, regionalIraqExposureReason: reason });
    } else {
      removed.push({ id: article.id || "", title: article.titleKo || article.title || "", reason });
    }
  }

  payload.articles = kept;
  payload.count = kept.length;
  payload.counts = {
    total: kept.length,
    politics: kept.filter((x) => x.category3 === "politics").length,
    terror_security: kept.filter((x) => x.category3 === "terror_security").length,
    oil_economy: kept.filter((x) => x.category3 === "oil_economy").length,
    regional: kept.filter((x) => x.category3 === "regional").length,
    exclude: 0
  };
  payload.regionalIraqExposure = {
    inputRegional: input.filter((x) => x.collectionLane === "regional_context").length,
    keptRegional: kept.filter((x) => x.collectionLane === "regional_context").length,
    removedRegional: removed.length,
    removed: removed.slice(0, 100),
    completedAt: new Date().toISOString()
  };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.count = payload.count;
    index.counts = payload.counts;
    index.regionalIraqExposure = payload.regionalIraqExposure;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`[regional-iraq] kept=${payload.regionalIraqExposure.keptRegional}, removed=${removed.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
