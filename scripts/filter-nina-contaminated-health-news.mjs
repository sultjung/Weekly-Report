#!/usr/bin/env node
/**
 * Exclude NINA articles where unrelated page/sidebar text caused AI to hallucinate
 * Iraqi political actors into a short general-news story.
 *
 * Known examples:
 *   Key=1305453: Congo/Ebola health news -> hallucinated Al-Zaidi/local government/parliament.
 *   Key=1305421: Hajj/Umrah electronic lottery notice -> hallucinated Al-Zaidi/local government/parliament.
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

function textOf(article = {}, fields = []) {
  return fields.map((field) => article[field]).filter(Boolean).join("\n");
}

function rawText(article = {}) {
  return textOf(article, ["title", "description", "cleanText", "fullText", "url", "link"]);
}

function aiText(article = {}) {
  return [
    article.titleKo,
    article.summaryKo,
    article.weeklyReportReason,
    article.reportBullet,
    ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
    article.reportImplication,
    ...(Array.isArray(article.actors) ? article.actors : []),
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

const FOREIGN_HEALTH_TERMS = [
  "إيبولا", "ايبولا", "فيروس إيبولا", "حمى نزفية", "الكونغو", "جمهورية الكونغو", "افريقيا", "أفريقيا",
  "ebola", "congo", "democratic republic of congo", "virus", "hemorrhagic fever", "health ministry",
  "에볼라", "콩고", "바이러스", "출혈열", "보건", "감염병", "질병"
];

const HAJJ_UMRAH_NOTICE_TERMS = [
  "هيئة الحج والعمرة", "الحج والعمرة", "قرعة الحج", "قرعة الحج الإلكترونية", "التقديم لقرعة الحج", "فتح التقديم", "الحج الإلكترونية",
  "hajj", "umrah", "electronic lottery", "hajj lottery", "pilgrimage lottery",
  "하지", "우므라", "성지순례", "전자 추첨", "하즈", "하즈 추첨", "하지 추첨", "이라크 하즈 위원회", "이라크 하지 위원회"
];

const SHORT_NOTICE_TERMS = [
  ...FOREIGN_HEALTH_TERMS,
  ...HAJJ_UMRAH_NOTICE_TERMS
];

const AI_POLITICS_TERMS = [
  "Al-Zaidi", "알자이디", "총리", "내각", "의회", "지방 정부", "정부 운영", "서비스 제공", "정치적 논의", "본회의 재개",
  "cabinet", "parliament", "prime minister", "local government"
];

function isNina(article = {}) {
  return hasAny(`${article.source || ""} ${article.url || ""} ${article.link || ""}`, ["NINA", "ninanews.com"]);
}

function isKnownBadNinaSidebarArticle(article = {}) {
  const all = `${rawText(article)}\n${aiText(article)}`;
  return /Key=1305453|key=1305453|Key=1305421|key=1305421/i.test(all);
}

function rawHasRealIraqPolitics(article = {}) {
  const raw = rawText(article);
  return hasAny(raw, [
    "رئيس الوزراء", "مجلس النواب", "مجلس الوزراء", "الزيدي", "علي الزيدي", "الكابينة", "البرلمان",
    "prime minister", "parliament", "cabinet", "al-zaidi"
  ]);
}

function isNinaSidebarContaminated(article = {}) {
  if (!isNina(article)) return false;
  if (isKnownBadNinaSidebarArticle(article)) return true;

  const raw = rawText(article);
  const ai = aiText(article);
  const rawLooksShortGeneralNotice = hasAny(raw, SHORT_NOTICE_TERMS);
  const aiAddsPolitics = hasAny(ai, AI_POLITICS_TERMS);

  // If the actual article is a short public notice/health/general-news item,
  // but AI output turns it into Iraqi politics, treat as sidebar contamination.
  return rawLooksShortGeneralNotice && aiAddsPolitics && !rawHasRealIraqPolitics(article);
}

function classifyOriginalTopic(article = {}) {
  const raw = rawText(article);
  if (hasAny(raw, HAJJ_UMRAH_NOTICE_TERMS)) return "hajj_lottery";
  if (hasAny(raw, FOREIGN_HEALTH_TERMS)) return "foreign_health";
  return "general_notice";
}

function originalSummary(topic) {
  if (topic === "hajj_lottery") {
    return "원문은 이라크 하지·우므라 위원회의 전자 하지 추첨 신청 개시 공지로, Al-Zaidi 총리·지방정부·내각·의회 관련 정치 기사 아님.";
  }
  if (topic === "foreign_health") {
    return "원문은 콩고 에볼라 바이러스 등 해외 보건 일반뉴스로, Al-Zaidi 총리·지방정부·의회 관련 기사 아님.";
  }
  return "원문은 짧은 일반 공지성 기사로, AI 요약에 삽입된 Al-Zaidi 총리·내각·의회 맥락은 주변기사 혼입 가능성이 높음.";
}

function titleFor(topic) {
  if (topic === "hajj_lottery") return "NINA 하지·우므라 전자 추첨 공지, 정치권 동향 후보에서 제외";
  if (topic === "foreign_health") return "NINA 해외 보건 일반뉴스, 정치권 동향 후보에서 제외";
  return "NINA 일반 단신, 정치권 동향 후보에서 제외";
}

function fixArticle(article = {}) {
  if (!isNinaSidebarContaminated(article)) return article;

  const date = reportDate(article);
  const topic = classifyOriginalTopic(article);
  return {
    ...article,
    titleKo: titleFor(topic),
    summaryKo: `${originalSummary(topic)} 페이지 주변의 관련기사·사이드바 텍스트가 본문과 섞여 Al-Zaidi 총리·의회·내각 관련 내용으로 오인된 고위험 후보로 판단.`,
    category1: "domestic",
    category2: "politics_security",
    category3: "exclude",
    importanceScore: Math.min(Number(article.importanceScore || 0), 10),
    reportUsefulness: "exclude",
    weeklyReportReason: "NINA 페이지 주변기사/사이드바 혼입으로 원문에 없는 Al-Zaidi 총리·내각·의회 맥락이 삽입되어 제외.",
    reportBullet: `${date || "7.13"}, ${titleFor(topic)}`,
    reportSubBullets: [originalSummary(topic)],
    reportImplication: "",
    actors: [],
    location: "",
    ninaSidebarContaminationFiltered: true,
    ninaSidebarContaminationTopic: topic,
    ninaSidebarContaminationReason: "NINA short source article contaminated by related/sidebar political headlines."
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
  const filteredCount = fixed.filter((x) => x.ninaSidebarContaminationFiltered).length;

  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.ninaSidebarContaminationFilteredCount = filteredCount;
  payload.ninaSidebarContaminationFilteredAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.ninaSidebarContaminationFilteredCount = filteredCount;
    index.ninaSidebarContaminationFilteredAt = payload.ninaSidebarContaminationFilteredAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`NINA sidebar-contaminated short/general news filtered: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
