#!/usr/bin/env node
/**
 * Final deterministic quality gate for Weekly-Report news candidates.
 *
 * This runs after AI summarisation and the existing cleanup scripts. It removes
 * articles whose source text does not support the assigned report lane and
 * corrects a small set of high-risk formatting/role errors that must never be
 * delegated to the model alone.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function norm(value = "") {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function sourceLeadText(article = {}) {
  const body = String(article.cleanText || article.fullText || "").slice(0, 3500);
  return norm([
    article.title,
    article.description,
    body
  ].filter(Boolean).join("\n"));
}

function sourceTitleText(article = {}) {
  return norm([article.title, article.description].filter(Boolean).join("\n"));
}

function aiText(article = {}) {
  return norm([
    article.titleKo,
    article.summaryKo,
    article.weeklyReportReason,
    article.reportBullet,
    ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
    article.reportImplication,
    ...(Array.isArray(article.actors) ? article.actors : []),
    article.location
  ].filter(Boolean).join("\n"));
}

const IRAQ_RE = /العراق|عراقي|العراقية|بغداد|البصرة|الموصل|نينوى|أربيل|اربيل|كركوك|الأنبار|الانبار|ديالى|كربلاء|النجف|السليمانية|إقليم كردستان|اقليم كردستان|الحكومة العراقية|البرلمان العراقي|رئيس الوزراء العراقي|مجلس الوزراء العراقي|مجلس النواب العراقي|الإطار التنسيقي|الهيئة الوطنية للاستثمار|بسماية|بسمايه|هانوا|iraq|iraqi|baghdad|basra|mosul|nineveh|erbil|kirkuk|anbar|diyala|karbala|najaf|sulaymaniyah|iraqi kurdistan|kurdistan region of iraq|krg|bismayah|bismaya|bncp|hanwha|national investment commission|이라크|바그다드|바스라|모술|니나와|아르빌|에르빌|키르쿠크|안바르|디얄라|카르발라|나자프|쿠르드 자치정부|비스마야|한화|시아조정기구/iu;
const POLITICS_RE = /مجلس الوزراء|رئيس الوزراء|مجلس النواب|البرلمان|الحكومة|انتخابات|الإطار التنسيقي|النزاهة|فساد|الهيئة الوطنية للاستثمار|cabinet|prime minister|parliament|government|election|coordination framework|corruption|national investment commission|국무회의|내각|총리|의회|정부|선거|시아조정기구|부패|청렴위원회|nic/iu;
const SECURITY_RE = /داعش|إرهاب|ارهاب|هجوم مسلح|هجوم إرهابي|اشتباك|عبوة ناسفة|تفجير|انتحاري|اغتيال|إطلاق نار|اطلاق نار|قصف|صاروخ|طائرة مسيرة|خطف|اعتقال|إلقاء القبض|القاء القبض|ضبط|تظاهرات|احتجاجات|اعتصام|إغلاق الطرق|isis|terror|armed attack|clash|ied|bombing|suicide bomb|assassination|shooting|rocket|drone|kidnap|arrest|detained|seized|protest|demonstration|road closure|테러|무장 공격|교전|급조폭발물|폭탄|자살폭탄|암살|총격|로켓|드론|납치|체포|구금|압수|시위|집회|도로 통제/iu;
const MIDDLE_EAST_ACTOR_RE = /إيران|ايران|إسرائيل|اسرائيل|سوريا|غزة|فلسطين|الحوثي|اليمن|لبنان|حزب الله|حماس|البحر الأحمر|مضيق هرمز|باب المندب|الخليج|iran|israel|syria|gaza|palestine|houthi|yemen|lebanon|hezbollah|hamas|red sea|hormuz|bab al-mandab|persian gulf|이란|이스라엘|시리아|가자|팔레스타인|후티|예멘|레바논|헤즈볼라|하마스|홍해|호르무즈|바브엘만데브|페르시아만/iu;
const STRATEGIC_RE = /حرب|ضربة|ضربات|قصف|صاروخ|طائرة مسيرة|تصعيد|رد عسكري|عقوبات|إغلاق|تعطيل الملاحة|هجوم|اشتباك|إجلاء|حدود|داعش|war|strike|airstrike|bombing|missile|drone|escalation|retaliation|sanctions|closure|shipping disruption|attack|clash|evacuation|border|isis|oil supply|oil export|tanker|shipping|navigation|supply chain|전쟁|공습|폭격|미사일|드론|확전|보복|제재|봉쇄|항행|해운|대피|국경|isis|원유 공급|원유 수출|유조선|공급망/iu;
const OIL_MARKET_RE = /국제유가|원유 가격|원유 선물|두바이유|브렌트유|서부텍사스유|\bwti\b|\bopec\+?\b|석유수출국기구|crude oil|oil price|oil futures|brent|west texas intermediate|dubai crude|أوبك|أسعار النفط|النفط الخام/iu;
const RETAIL_FUEL_RE = /휘발유|경유|주유소|기름값|유류세|리터당|자동차 연료|소비자 가격|gasoline|petrol|diesel|pump price|fuel tax|retail fuel/iu;

export function sanitizeReportBullet(value = "") {
  return String(value || "")
    .replace(/^\s*[-*·•]+\s*/, "")
    .replace(/^\s*(?:m\s*[.·]?\s*d\s*[.]?)\s*[,.:：-]?\s*/i, "")
    .replace(/^\s*\d{1,2}\s*\.\s*\d{1,2}\s*[,.:：-]\s*/, "")
    .trim();
}

function replaceZaidiRole(value = "") {
  return String(value || "")
    .replace(/이라크\s*외무(?:부)?\s*장관\s*,?\s*Al[- ]?Zaidi/gi, "Al-Zaidi 총리")
    .replace(/Al[- ]?Zaidi\s*(?:이라크\s*)?외무(?:부)?\s*장관/gi, "Al-Zaidi 총리")
    .replace(/외무(?:부)?\s*장관\s*Al[- ]?Zaidi/gi, "Al-Zaidi 총리")
    .replace(/Foreign Minister\s+Al[- ]?Zaidi/gi, "Al-Zaidi 총리")
    .replace(/Al[- ]?Zaidi\s+Foreign Minister/gi, "Al-Zaidi 총리");
}

function rawSupportsZaidiAsPrimeMinister(article = {}) {
  const raw = sourceLeadText(article);
  const hasZaidi = /علي\s+الزيدي|الزيدي|ali\s+al[- ]?zaidi|al[- ]?zaidi/iu.test(raw);
  const hasPrimeMinister = /رئيس\s+(?:مجلس\s+)?الوزراء|رئيس\s+الحكومة|prime minister|premier/iu.test(raw);
  return hasZaidi && hasPrimeMinister;
}

export function applyDeterministicCorrections(article = {}) {
  const corrected = { ...article };
  corrected.reportBullet = sanitizeReportBullet(corrected.reportBullet);

  if (rawSupportsZaidiAsPrimeMinister(article)) {
    for (const key of ["titleKo", "summaryKo", "weeklyReportReason", "reportBullet", "reportImplication", "location"]) {
      corrected[key] = replaceZaidiRole(corrected[key]);
    }
    corrected.reportSubBullets = (Array.isArray(corrected.reportSubBullets) ? corrected.reportSubBullets : []).map(replaceZaidiRole);
    corrected.actors = (Array.isArray(corrected.actors) ? corrected.actors : []).map(replaceZaidiRole);
    corrected.factCorrectionApplied = aiText(article) !== aiText(corrected);
    if (corrected.factCorrectionApplied) corrected.factCorrectionReason = "원문상 Al-Zaidi의 직책은 이라크 총리로 확인되어 외무장관 오표기를 교정";
  }

  return corrected;
}

export function exclusionReason(article = {}) {
  const category = String(article.category3 || "");
  const raw = sourceLeadText(article);
  const title = sourceTitleText(article);

  if (category === "oil_economy") {
    if (RETAIL_FUEL_RE.test(title)) {
      return "국제 원유시장 자체가 아니라 국내 지역 휘발유·경유·주유소 소비자가격이 중심인 기사";
    }
    if (!OIL_MARKET_RE.test(title) && !OIL_MARKET_RE.test(raw)) {
      return "Brent·WTI·Dubai·OPEC·원유 수급 등 국제유가 핵심 근거가 확인되지 않은 기사";
    }
    return "";
  }

  if (category === "regional") {
    if (!MIDDLE_EAST_ACTOR_RE.test(raw) || !STRATEGIC_RE.test(raw)) {
      return "이라크 현장 안전·항공·해운·원유·공급망에 영향을 줄 중동 핵심 정세 근거가 없는 일반 해외기사";
    }
    return "";
  }

  if (category === "politics" || category === "terror_security") {
    if (!IRAQ_RE.test(raw)) {
      return "원문 제목·도입부에 이라크·비스마야·BNCP 직접 연계가 없는 제3국 기사";
    }
    if (category === "politics" && !POLITICS_RE.test(raw) && !/بسماية|بسمايه|bismayah|bismaya|bncp|hanwha|هانوا|비스마야|한화/iu.test(raw)) {
      return "원문상 이라크 정치·정부·의회·NIC 또는 BNCP 관련 핵심 사실이 확인되지 않은 기사";
    }
    if (category === "terror_security" && !SECURITY_RE.test(raw)) {
      return "원문상 이라크 내 실제 테러·치안·시위 사건이 확인되지 않은 기사";
    }
  }

  return "";
}

function recalcCounts(articles = []) {
  return {
    total: articles.length,
    politics: articles.filter((x) => x.category3 === "politics").length,
    terror_security: articles.filter((x) => x.category3 === "terror_security").length,
    oil_economy: articles.filter((x) => x.category3 === "oil_economy").length,
    regional: articles.filter((x) => x.category3 === "regional").length,
    exclude: articles.filter((x) => x.category3 === "exclude" || x.reportUsefulness === "exclude").length
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const removed = [];
  const kept = [];
  let correctedCount = 0;

  for (const rawArticle of articles) {
    const article = applyDeterministicCorrections(rawArticle);
    if (article.factCorrectionApplied) correctedCount += 1;

    const reason = article.category3 === "exclude" || article.reportUsefulness === "exclude"
      ? (article.weeklyReportReason || "기존 후처리 단계에서 제외 판정")
      : exclusionReason(article);

    if (reason) {
      removed.push({
        id: article.id || "",
        title: article.titleKo || article.title || "",
        category3: article.category3 || "",
        reason
      });
      continue;
    }

    kept.push(article);
  }

  payload.articles = kept;
  payload.count = kept.length;
  payload.counts = recalcCounts(kept);
  payload.strictQualityGate = {
    appliedAt: new Date().toISOString(),
    removedCount: removed.length,
    correctedCount,
    removed: removed.slice(0, 100)
  };

  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.count = payload.count;
    index.counts = payload.counts;
    index.strictQualityGate = {
      appliedAt: payload.strictQualityGate.appliedAt,
      removedCount: removed.length,
      correctedCount
    };
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Strict quality gate: kept=${kept.length}, removed=${removed.length}, corrected=${correctedCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
