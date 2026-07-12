#!/usr/bin/env node
/**
 * Filter foreign-only articles from Iraqi media sources.
 *
 * Iraqi outlets such as NINA publish regional/world news. Those articles should not
 * become Iraq weekly-report candidates unless the article itself has an Iraq link.
 *
 * Example learned rule:
 * - Hakan Fidan / فيدان is Turkey's foreign minister.
 * - A Fidan-only foreign-policy article is excluded unless it mentions Iraq, Baghdad,
 *   Erbil/KRG, Iraqi Kurdistan, Iraq border/security, PKK in Iraq, etc.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function textOf(article = {}) {
  return [
    article.url,
    article.source,
    article.title,
    article.titleKo,
    article.description,
    article.summaryKo,
    article.weeklyReportReason,
    article.reportBullet,
    ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
    article.reportImplication,
    ...(Array.isArray(article.actors) ? article.actors : []),
    article.location
  ].filter(Boolean).join(" ").toLowerCase();
}

const IRAQ_LINK_RE = /العراق|عراقي|العراقية|بغداد|البصرة|الموصل|نينوى|أربيل|اربيل|كركوك|الأنبار|الانبار|ديالى|كربلاء|النجف|السليمانية|إقليم كردستان|اقليم كردستان|كردستان العراق|الحكومة العراقية|البرلمان العراقي|رئيس الوزراء العراقي|العلاقات العراقية|iraq|iraqi|baghdad|basra|mosul|nineveh|erbil|kirkuk|anbar|diyala|karbala|najaf|sulaymaniyah|iraqi kurdistan|kurdistan region of iraq|krg|iraq border|iraqi border|이라크|바그다드|바스라|모술|니나와|아르빌|에르빌|키르쿠크|안바르|디얄라|카르발라|나자프|이라크 쿠르드|쿠르드 자치정부|이라크 국경/iu;

const FIDAN_RE = /\bفيدان\b|هاكان\s+فيدان|hakan\s+fidan|turkish foreign minister|foreign minister of turkey|turkey'?s foreign minister|터키\s*외무장관|하칸\s*피단|피단|fidan/i;
const TURKEY_ONLY_RE = /تركيا|التركية|أنقرة|انقرة|أردوغان|اردوغان|وزارة الخارجية التركية|تركيا وسوريا|تركيا وإسرائيل|turkey|turkish|ankara|erdogan|튀르키예|터키|앙카라|에르도안/i;

function isFidanOnlyForeign(article = {}) {
  const text = textOf(article);
  if (!FIDAN_RE.test(text)) return false;
  if (IRAQ_LINK_RE.test(text)) return false;
  return true;
}

function isForeignOnlyWithoutIraq(article = {}) {
  const text = textOf(article);
  if (IRAQ_LINK_RE.test(text)) return false;

  // Conservative rule: only exclude obvious Turkey/Fidan-only items for now.
  // Wider international items are kept if the current project intentionally monitors them.
  if (FIDAN_RE.test(text) || (TURKEY_ONLY_RE.test(text) && /ninanews\.com|nina/i.test(text))) return true;
  return false;
}

function markExcluded(article, reason) {
  return {
    ...article,
    category3: "exclude",
    reportUsefulness: "exclude",
    weeklyReportReason: reason,
    irrelevantForeignFiltered: true
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
  let filteredCount = 0;

  const cleaned = articles.map((article) => {
    if (isFidanOnlyForeign(article)) {
      filteredCount += 1;
      return markExcluded(article, "Fidan/터키 외교 기사이나 이라크 직접 연관성이 없어 보고서 후보에서 제외");
    }
    if (isForeignOnlyWithoutIraq(article)) {
      filteredCount += 1;
      return markExcluded(article, "이라크 언론사 게재 기사이나 기사 내용상 이라크 직접 연관성이 없어 제외");
    }
    return article;
  });

  payload.articles = cleaned;
  payload.counts = recalcCounts(cleaned);
  payload.irrelevantForeignFilteredCount = filteredCount;
  payload.irrelevantForeignFilteredAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.irrelevantForeignFilteredCount = filteredCount;
    index.irrelevantForeignFilteredAt = payload.irrelevantForeignFilteredAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch {}

  console.log(`Filtered irrelevant foreign-only candidates: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
