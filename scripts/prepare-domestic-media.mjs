#!/usr/bin/env node
/** Preserve Korean-language Iraq coverage as a separate domestic-media lane. */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const SPORTS_RE = /축구|농구|배구|야구|월드컵|아시안컵|올림픽|경기\s*(?:결과|일정|중계)|대표팀|선수|감독|리그|득점|football|soccer|world cup|match|fixture|league/iu;
const KOREAN_RE = /[가-힣]/;

const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
let prepared = 0;
let sportsRemoved = 0;

payload.articles = articles.filter((article) => {
  const original = [article.title, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n");
  const isKoreanDomestic = article.queryGroup === "korean_domestic_media" || KOREAN_RE.test(String(article.title || ""));
  if (!isKoreanDomestic) return true;
  if (SPORTS_RE.test(original)) {
    sportsRemoved += 1;
    return false;
  }
  article.queryGroup = "korean_domestic_media";
  article.collectionLane = "regional_context";
  article.regionalIraqExposureReason = "국내 언론 이라크 관련 기사";
  article.domesticMedia = true;
  prepared += 1;
  return true;
});

payload.count = payload.articles.length;
payload.domesticMediaPreparation = {
  prepared,
  sportsRemoved,
  completedAt: new Date().toISOString()
};
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-media] prepared=${prepared}, sportsRemoved=${sportsRemoved}`);
