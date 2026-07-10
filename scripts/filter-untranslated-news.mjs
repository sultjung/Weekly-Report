#!/usr/bin/env node
/**
 * Remove untranslated Arabic leftovers from report candidate data.
 *
 * If AI enrichment fails, the collector may still keep the original Arabic title/summary.
 * For a Korean weekly report workflow, those items should not be shown as usable candidates.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");
const ARABIC_RE = /[\u0600-\u06FF]/;
const KOREAN_RE = /[가-힣]/;

function isUntranslated(article = {}) {
  const titleKo = String(article.titleKo || "").trim();
  const summaryKo = String(article.summaryKo || "").trim();
  const reportBullet = String(article.reportBullet || "").trim();
  const koFields = [titleKo, summaryKo, reportBullet].join("\n");

  if (article.translationFailed) return true;
  if (!titleKo || !summaryKo) return true;
  if (ARABIC_RE.test(titleKo) || ARABIC_RE.test(summaryKo) || ARABIC_RE.test(reportBullet)) return true;
  if (!KOREAN_RE.test(koFields)) return true;
  return false;
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
    if (!isUntranslated(article)) return article;
    filteredCount += 1;
    return {
      ...article,
      category3: "exclude",
      category2: article.category2 || "politics_security",
      category1: article.category1 || "domestic",
      reportUsefulness: "exclude",
      weeklyReportReason: "AI 번역/요약 실패로 보고서 후보에서 제외",
      translationFailed: true,
      untranslatedFiltered: true
    };
  });

  payload.articles = cleaned;
  payload.counts = recalcCounts(cleaned);
  payload.untranslatedFilteredCount = filteredCount;
  payload.untranslatedFilteredAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.untranslatedFilteredCount = filteredCount;
    index.untranslatedFilteredAt = payload.untranslatedFilteredAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch {}

  console.log(`Filtered untranslated news candidates: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
