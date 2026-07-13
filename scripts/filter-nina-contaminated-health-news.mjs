#!/usr/bin/env node
/**
 * Exclude NINA articles where unrelated page/sidebar text caused AI to hallucinate
 * Iraqi political actors into a foreign health/general-news story.
 *
 * Known example:
 *   https://ninanews.com/website/News/Details?Key=1305453
 *   Source topic: Congo/Ebola health news.
 *   Bad AI: Al-Zaidi PM / local government / parliament / cabinet.
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

const AI_POLITICS_TERMS = [
  "Al-Zaidi", "알자이디", "총리", "내각", "의회", "지방 정부", "정부 운영", "서비스 제공", "정치적 논의", "본회의 재개",
  "cabinet", "parliament", "prime minister", "local government"
];

const IRAQ_SOURCE_CONTEXT_TERMS = [
  "العراق", "بغداد", "النجف", "كربلاء", "البصرة", "نينوى", "ديالى", "اربيل", "أربيل", "رئيس الوزراء", "مجلس النواب", "مجلس الوزراء",
  "iraq", "baghdad", "najaf", "karbala", "basra", "parliament", "prime minister"
];

function isKnownBadNinaHealthArticle(article = {}) {
  const all = `${rawText(article)}\n${aiText(article)}`;
  return /Key=1305453|key=1305453/i.test(all);
}

function isForeignHealthContaminated(article = {}) {
  const raw = rawText(article);
  const ai = aiText(article);
  const isNina = hasAny(`${article.source || ""} ${article.url || ""} ${article.link || ""}`, ["NINA", "ninanews.com"]);
  if (!isNina) return false;

  if (isKnownBadNinaHealthArticle(article)) return true;

  const rawLooksForeignHealth = hasAny(raw, FOREIGN_HEALTH_TERMS);
  const aiAddsPolitics = hasAny(ai, AI_POLITICS_TERMS);
  const rawHasIraqPolitics = hasAny(raw, ["رئيس الوزراء", "مجلس النواب", "مجلس الوزراء", "الزيدي", "علي الزيدي", "الكابينة", "البرلمان"]);

  // If the actual article topic is foreign health/general news, but AI output turns it into Iraqi politics,
  // treat it as sidebar/related-link contamination.
  return rawLooksForeignHealth && aiAddsPolitics && !rawHasIraqPolitics;
}

function fixArticle(article = {}) {
  if (!isForeignHealthContaminated(article)) return article;

  const date = reportDate(article);
  return {
    ...article,
    titleKo: "NINA 해외 보건 일반뉴스, 정치권 동향 후보에서 제외",
    summaryKo: "원문 주제가 콩고 에볼라 바이러스 등 해외 보건 일반뉴스로 확인되어 이라크 정치권 동향과 직접 관련성 낮음. 페이지 주변의 관련기사·사이드바 텍스트가 본문과 섞여 Al-Zaidi 총리·의회·내각 관련 내용으로 오인된 고위험 후보로 판단.",
    category1: "domestic",
    category2: "politics_security",
    category3: "exclude",
    importanceScore: Math.min(Number(article.importanceScore || 0), 10),
    reportUsefulness: "exclude",
    weeklyReportReason: "NINA 페이지 주변기사/사이드바 혼입으로 원문에 없는 Al-Zaidi 총리·내각·의회 맥락이 삽입되어 제외.",
    reportBullet: `${date || "7.13"}, NINA 해외 보건 일반뉴스, 이라크 정치권 동향 후보에서 제외`,
    reportSubBullets: ["원문은 콩고 에볼라 바이러스 등 해외 보건 이슈로, Al-Zaidi 총리·지방정부·의회 관련 기사 아님."],
    reportImplication: "",
    actors: [],
    location: "",
    ninaSidebarContaminationFiltered: true,
    ninaSidebarContaminationReason: "Foreign health article contaminated by NINA related/sidebar political headlines."
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

  console.log(`NINA sidebar-contaminated health/general news filtered: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
