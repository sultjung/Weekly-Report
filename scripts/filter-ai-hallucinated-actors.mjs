#!/usr/bin/env node
/**
 * Detect and exclude high-risk AI hallucinations where the Korean summary/report
 * introduces national political actors that are not present in the source article.
 *
 * Example:
 *   Source: Najaf shrine met Yusuf Kanawi / local governorate officials.
 *   Bad AI: Al-Zaidi PM met Najaf governor and government officials.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function norm(value = "") {
  return String(value || "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\u0640/g, "")
    .toLowerCase();
}

function rawText(article = {}) {
  return [article.title, article.description, article.cleanText, article.fullText]
    .filter(Boolean)
    .join("\n");
}

function aiText(article = {}) {
  return [
    article.titleKo,
    article.summaryKo,
    article.weeklyReportReason,
    article.reportBullet,
    ...(article.reportSubBullets || []),
    article.reportImplication,
    ...(article.actors || []),
    article.location
  ].filter(Boolean).join("\n");
}

function hasAny(text = "", terms = []) {
  const x = norm(text);
  return terms.some((term) => x.includes(norm(term)));
}

function reportDate(article = {}) {
  const d = new Date(article.publishedAt || article.date || 0);
  return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}.${d.getDate()}`;
}

const ZAIDI_AI_TERMS = [
  "Al-Zaidi", "알자이디", "알-자이디", "자이디", "الزيدي", "علي الزيدي", "علي الزيادي",
  "총리", "prime minister", "رئيس الوزراء", "رئيس الحكومة"
];

const ZAIDI_RAW_TERMS = [
  "الزيدي", "علي الزيدي", "علي الزيادي", "رئيس الوزراء", "رئيس الحكومة", "رئاسة الوزراء",
  "prime minister", "al-zaidi", "zaidi", "رئيس مجلس الوزراء"
];

const CENTRAL_POLITICAL_AI_TERMS = [
  "내각 구성", "내각", "의회 활동", "이라크 의회", "장관", "총리", "중앙정부", "정치적 맥락",
  "cabinet", "parliament", "minister", "prime minister"
];

const CENTRAL_POLITICAL_RAW_TERMS = [
  "مجلس الوزراء", "مجلس النواب", "البرلمان", "الكابينة", "الوزراء", "رئيس الوزراء", "رئيس الحكومة",
  "cabinet", "parliament", "minister", "prime minister"
];

const NAJAF_SHRINE_LOCAL_TERMS = [
  "العتبة العلوية", "العتبة العلوية المقدسة", "النجف", "محافظ النجف", "يوسف كناوي", "يوسف الكناني", "دوائر المحافظة", "الحكومة المحلية",
  "alawi shrine", "imam ali shrine", "najaf governor", "yusuf kanawi", "local government", "governorate departments"
];

function isNajafShrineLocalMeeting(article = {}) {
  const raw = rawText(article);
  return hasAny(raw, ["العتبة العلوية", "العتبة العلوية المقدسة", "alawi shrine", "imam ali shrine"])
    && hasAny(raw, ["محافظ النجف", "النجف", "najaf governor", "najaf"])
    && hasAny(raw, ["يوسف كناوي", "يوسف الكناني", "yusuf kanawi", "yusuf al-kanawi", "دوائر المحافظة", "governorate departments"]);
}

function isZaidiHallucination(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  const aiAddsZaidiOrPm = hasAny(ai, ZAIDI_AI_TERMS);
  const rawHasZaidiOrPm = hasAny(raw, ZAIDI_RAW_TERMS);
  return aiAddsZaidiOrPm && !rawHasZaidiOrPm;
}

function isCentralPoliticsHallucination(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  return hasAny(ai, CENTRAL_POLITICAL_AI_TERMS)
    && !hasAny(raw, CENTRAL_POLITICAL_RAW_TERMS)
    && isNajafShrineLocalMeeting(article);
}

function exclusionSummary(article = {}) {
  if (isNajafShrineLocalMeeting(article)) {
    return "나자프, 성스러운 알라위 성지 측이 Yusuf Kanawi 나자프 주지사 및 주정부 산하 여러 기관 고위 간부들을 접견.";
  }
  return "AI 요약 결과에 원문에 없는 핵심 인물·기관이 포함되어 보고서 후보에서 제외.";
}

function fixArticle(article = {}) {
  const hallucinatedZaidi = isZaidiHallucination(article);
  const hallucinatedCentralPolitics = isCentralPoliticsHallucination(article);
  if (!hallucinatedZaidi && !hallucinatedCentralPolitics) return article;

  const date = reportDate(article);
  const rawHasNajaf = isNajafShrineLocalMeeting(article);

  return {
    ...article,
    titleKo: rawHasNajaf ? "나자프 알라위 성지, 나자프 주지사 및 주정부 관계자 접견" : (article.titleKo || article.title || "원문 검증 필요 기사"),
    summaryKo: exclusionSummary(article),
    category1: "domestic",
    category2: "politics_security",
    category3: "exclude",
    importanceScore: Math.min(Number(article.importanceScore || 0), 15),
    reportUsefulness: "exclude",
    weeklyReportReason: "원문에 없는 Al-Zaidi 총리/중앙정치 맥락이 AI 요약에 삽입되어 제외. 비스마야·이라크 중앙정세·치안과 직접 관련성 낮음.",
    reportBullet: rawHasNajaf ? `${date || "7.12"}, 나자프 알라위 성지 측, Yusuf Kanawi 나자프 주지사 및 주정부 관계자 접견` : (article.reportBullet || ""),
    reportSubBullets: rawHasNajaf ? ["원문은 지방 성지·주정부 관계자 접견 동정이며 Al-Zaidi 총리 관련 내용 없음."] : [],
    reportImplication: "",
    actors: rawHasNajaf ? ["알라위 성지", "Yusuf Kanawi", "나자프 주정부"] : [],
    location: rawHasNajaf ? "Najaf" : article.location,
    aiHallucinationFiltered: true,
    aiHallucinationReason: hallucinatedZaidi ? "AI introduced Al-Zaidi/PM although source did not mention him." : "AI introduced central politics although source was local Najaf shrine/governorate news."
  };
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
  const fixed = articles.map(fixArticle);
  const filteredCount = fixed.filter((x) => x.aiHallucinationFiltered).length;

  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.aiHallucinationFilteredCount = filteredCount;
  payload.aiHallucinationFilteredAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.aiHallucinationFilteredCount = filteredCount;
    index.aiHallucinationFilteredAt = payload.aiHallucinationFilteredAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch {}

  console.log(`AI hallucinated actor articles filtered: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
