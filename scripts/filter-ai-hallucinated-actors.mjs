#!/usr/bin/env node
/**
 * Detect and exclude high-risk AI hallucinations where the Korean summary/report
 * introduces national political actors that are not present in the source article.
 *
 * Examples:
 *   Source: Najaf shrine met Yusuf Kanawi / local governorate officials.
 *   Bad AI: Al-Zaidi PM met Najaf governor and government officials.
 *
 *   Source: Zurbatiya border crossing held an Arbaeen preparations meeting.
 *   Bad AI: Al-Zaidi PM discussed cabinet/parliament context.
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
  "내각 구성", "내각", "의회 활동", "의회 본회의", "이라크 의회", "장관", "총리", "중앙정부", "정치적 맥락",
  "정치적 불확실성", "cabinet", "parliament", "minister", "prime minister"
];

const CENTRAL_POLITICAL_RAW_TERMS = [
  "مجلس الوزراء", "مجلس النواب", "البرلمان", "الكابينة", "الوزراء", "رئيس الوزراء", "رئيس الحكومة",
  "cabinet", "parliament", "minister", "prime minister"
];

const NAJAF_SHRINE_LOCAL_TERMS = [
  "العتبة العلوية", "العتبة العلوية المقدسة", "النجف", "محافظ النجف", "يوسف كناوي", "يوسف الكناني", "دوائر المحافظة", "الحكومة المحلية",
  "alawi shrine", "imam ali shrine", "najaf governor", "yusuf kanawi", "local government", "governorate departments"
];

const ZURBATIYA_ARBAEEN_TERMS = [
  "زرباطية", "زرباطيه", "منفذ زرباطية", "زرباطية الحدودي", "zurbatiya", "zurbatia", "zurbatiyah",
  "الاربعين", "الأربعين", "زيارة الاربعين", "زيارة الأربعين", "arbaeen", "arba'in", "arba’in",
  "الزيارة", "الزائرين", "الزوار", "موسم الزيارة", "preparations", "زيارة", "통과", "아르바인", "순례", "방문 준비"
];

const LOCAL_ADMIN_TERMS = [
  "محافظ", "محافظة", "دوائر المحافظة", "الحكومة المحلية", "اللجنة", "اجتماع", "استعدادات", "الخدمات", "الدوائر الخدمية",
  "governor", "governorate", "local government", "service departments", "preparation meeting", "준비 회의", "지방 정부", "주정부", "서비스"
];

function isNajafShrineLocalMeeting(article = {}) {
  const raw = rawText(article);
  return hasAny(raw, ["العتبة العلوية", "العتبة العلوية المقدسة", "alawi shrine", "imam ali shrine"])
    && hasAny(raw, ["محافظ النجف", "النجف", "najaf governor", "najaf"])
    && hasAny(raw, ["يوسف كناوي", "يوسف الكناني", "yusuf kanawi", "yusuf al-kanawi", "دوائر المحافظة", "governorate departments"]);
}

function isZurbatiyaArbaeenLocalPrep(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  const url = String(article.url || "");
  const titleAndLead = [article.title, article.description, article.titleKo, article.summaryKo, article.reportBullet].filter(Boolean).join("\n");

  if (/Key=1305425/i.test(url)) return true;

  return hasAny(titleAndLead, ZURBATIYA_ARBAEEN_TERMS)
    && (hasAny(raw, LOCAL_ADMIN_TERMS) || hasAny(titleAndLead, LOCAL_ADMIN_TERMS) || hasAny(ai, LOCAL_ADMIN_TERMS));
}

function isZaidiHallucination(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  const aiAddsZaidiOrPm = hasAny(ai, ZAIDI_AI_TERMS);
  const rawHasZaidiOrPm = hasAny(raw, ZAIDI_RAW_TERMS);

  // For NINA pages, related-article titles can leak into rawText. Local-administration articles
  // should still be excluded when AI turns them into Al-Zaidi/cabinet/parliament stories.
  if (aiAddsZaidiOrPm && (isNajafShrineLocalMeeting(article) || isZurbatiyaArbaeenLocalPrep(article))) return true;

  return aiAddsZaidiOrPm && !rawHasZaidiOrPm;
}

function isCentralPoliticsHallucination(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  const aiHasCentralPolitics = hasAny(ai, CENTRAL_POLITICAL_AI_TERMS);

  if (aiHasCentralPolitics && (isNajafShrineLocalMeeting(article) || isZurbatiyaArbaeenLocalPrep(article))) return true;

  return aiHasCentralPolitics
    && !hasAny(raw, CENTRAL_POLITICAL_RAW_TERMS)
    && isNajafShrineLocalMeeting(article);
}

function exclusionSummary(article = {}) {
  if (isNajafShrineLocalMeeting(article)) {
    return "나자프, 성스러운 알라위 성지 측이 Yusuf Kanawi 나자프 주지사 및 주정부 산하 여러 기관 고위 간부들을 접견.";
  }
  if (isZurbatiyaArbaeenLocalPrep(article)) {
    return "Zurbatiya 국경 통과 지점에서 Arbaeen 순례객 방문 준비를 위한 지방 행정·서비스 관련 회의 진행.";
  }
  return "AI 요약 결과에 원문에 없는 핵심 인물·기관이 포함되어 보고서 후보에서 제외.";
}

function localReportBullet(article = {}) {
  const date = reportDate(article) || "7.12";
  if (isNajafShrineLocalMeeting(article)) {
    return `${date}, 나자프 알라위 성지 측, Yusuf Kanawi 나자프 주지사 및 주정부 관계자 접견`;
  }
  if (isZurbatiyaArbaeenLocalPrep(article)) {
    return `${date}, Zurbatiya 국경 통과 지점, Arbaeen 순례객 방문 준비 회의 진행`;
  }
  return article.reportBullet || "";
}

function localActors(article = {}) {
  if (isNajafShrineLocalMeeting(article)) return ["알라위 성지", "Yusuf Kanawi", "나자프 주정부"];
  if (isZurbatiyaArbaeenLocalPrep(article)) return ["Zurbatiya 국경 통과 지점", "Arbaeen 순례 준비 관계자", "지방 행정기관"];
  return [];
}

function localLocation(article = {}) {
  if (isNajafShrineLocalMeeting(article)) return "Najaf";
  if (isZurbatiyaArbaeenLocalPrep(article)) return "Zurbatiya";
  return article.location;
}

function fixArticle(article = {}) {
  const hallucinatedZaidi = isZaidiHallucination(article);
  const hallucinatedCentralPolitics = isCentralPoliticsHallucination(article);
  if (!hallucinatedZaidi && !hallucinatedCentralPolitics) return article;

  const localPrep = isZurbatiyaArbaeenLocalPrep(article);
  const rawHasNajaf = isNajafShrineLocalMeeting(article);

  return {
    ...article,
    titleKo: rawHasNajaf
      ? "나자프 알라위 성지, 나자프 주지사 및 주정부 관계자 접견"
      : localPrep
        ? "Zurbatiya 국경 통과 지점, Arbaeen 순례 준비 회의"
        : (article.titleKo || article.title || "원문 검증 필요 기사"),
    summaryKo: exclusionSummary(article),
    category1: "domestic",
    category2: "politics_security",
    category3: "exclude",
    importanceScore: Math.min(Number(article.importanceScore || 0), 15),
    reportUsefulness: "exclude",
    weeklyReportReason: "원문 또는 본문 핵심 내용에 없는 Al-Zaidi 총리/내각/의회 맥락이 AI 요약에 삽입되어 제외. 관련기사·사이드바 텍스트 혼입 가능성 있음.",
    reportBullet: localReportBullet(article),
    reportSubBullets: ["원문은 지방 행정·서비스 준비 동정이며 Al-Zaidi 총리, 내각 구성, 이라크 의회 관련 내용으로 보기 어려움."],
    reportImplication: "",
    actors: localActors(article),
    location: localLocation(article),
    aiHallucinationFiltered: true,
    aiHallucinationReason: hallucinatedZaidi
      ? "AI introduced Al-Zaidi/PM although source article body did not support it or it appeared only in related/sidebar text."
      : "AI introduced central politics although source was local administration/service-preparation news."
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
