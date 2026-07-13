#!/usr/bin/env node
/**
 * Fix known high-value political articles whose earlier AI summaries were too shallow.
 * These corrections act as deterministic examples of the expected weekly report style.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function reportDate(article = {}) {
  const d = new Date(article.publishedAt || article.date || 0);
  return Number.isNaN(d.getTime()) ? "7.7" : `${d.getMonth() + 1}.${d.getDate()}`;
}

function isMalikiAntiCorruptionArticle(article = {}) {
  const text = [article.url, article.title, article.titleKo, article.summaryKo, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n");
  return /964media\.com\/696180/i.test(text)
    || (/المالكي|Al-Maliki|말리키|Nouri Al-Maliki/i.test(text) && /فرهود|نهب|فساد|مكافحة الفساد|반부패|부패|약탈/i.test(text) && /الزيدي|Al-Zaidi|알자이디/i.test(text));
}

function fixArticle(article = {}) {
  if (!isMalikiAntiCorruptionArticle(article)) return article;
  const d = reportDate(article);
  return {
    ...article,
    titleKo: "Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 前 정부 부패 비판",
    summaryKo: "Nouri Al-Maliki 前 총리는 언론 인터뷰에서 Al-Sudani 前 총리 정부 시기 부패가 약탈 수준으로 확대되었다고 강하게 비판. 전력·항만 등 주요 부문에서 부패가 심각하게 확산되었다고 주장하는 한편, Al-Zaidi 총리의 반부패 체포·압수수색 작전을 정치 신뢰 회복을 위한 충격요법으로 평가. 다만 반부패 작전은 법적 절차와 제도적 기준 안에서 지속되어야 한다고 조건 제시.",
    category1: "domestic",
    category2: "politics_security",
    category3: "politics",
    importanceScore: Math.max(Number(article.importanceScore || 0), 86),
    reportUsefulness: "include",
    weeklyReportReason: "Al-Maliki 前 총리의 Al-Zaidi 총리 반부패 공세 공개 지지와 前 정부 부패 비판은 신임 총리의 부패척결 드라이브 및 시아 정치권 내부 역학 파악에 중요.",
    reportBullet: `${d}, Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 Al-Sudani 前 총리 정부 시기 부패 강력 비판`,
    reportSubBullets: [
      "Al-Maliki 前 총리, 전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었으며 전력·항만 등 주요 부문에서 확산되었다고 주장.",
      "Al-Zaidi 총리의 체포·압수수색 등 반부패 작전은 국민 신뢰 회복을 위한 충격요법으로 평가.",
      "다만 반부패 작전은 법적 절차와 제도적 기준, 정치적 통제 안에서 지속되어야 한다고 조건 제시."
    ],
    reportImplication: "Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석.",
    actors: ["Nouri Al-Maliki 前 총리", "Al-Zaidi 총리", "Al-Sudani 前 총리", "법치국가연합"],
    location: article.location || "Baghdad",
    knownPoliticalSummaryFixed: true,
    knownPoliticalSummaryReason: "Maliki anti-corruption interview required deeper human-style political analysis."
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
  const fixedCount = fixed.filter((x) => x.knownPoliticalSummaryFixed).length;

  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.knownPoliticalSummaryFixedCount = fixedCount;
  payload.knownPoliticalSummaryFixedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.knownPoliticalSummaryFixedCount = fixedCount;
    index.knownPoliticalSummaryFixedAt = payload.knownPoliticalSummaryFixedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Known political summaries fixed: ${fixedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
