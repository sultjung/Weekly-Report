#!/usr/bin/env node
/** Preserve only approved Korean-language coverage as a separate domestic-media lane. */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const SPORTS_RE = /축구|농구|배구|야구|월드컵|아시안컵|올림픽|경기\s*(?:결과|일정|중계)|대표팀|선수|감독|리그|득점|football|soccer|world cup|match|fixture|league/iu;
const KOREAN_RE = /[가-힣]/;
const BISMAYAH_RE = /비스마야/iu;
const IRAQ_RE = /이라크/iu;
const HANWHA_RE = /한화/iu;
const KIM_DONG_KWAN_RE = /김동관/iu;
const KIM_DONG_SEON_RE = /김동선/iu;

function sourceText(article = {}) {
  return [article.title, article.description, article.cleanText, article.fullText]
    .filter(Boolean)
    .join("\n");
}

function isApprovedDomesticArticle(article = {}) {
  const raw = sourceText(article);
  if (!KOREAN_RE.test(String(article.title || ""))) return false;
  if (SPORTS_RE.test(raw)) return false;
  if (BISMAYAH_RE.test(raw)) return true;
  if (IRAQ_RE.test(raw)) return true;
  if (HANWHA_RE.test(raw) && KIM_DONG_KWAN_RE.test(raw)) return true;
  if (HANWHA_RE.test(raw) && KIM_DONG_SEON_RE.test(raw)) return true;
  return false;
}

const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
let prepared = 0;
let sportsRemoved = 0;
let unrelatedKoreanRemoved = 0;

payload.articles = articles.filter((article) => {
  const raw = sourceText(article);
  const isKoreanOriginal = KOREAN_RE.test(String(article.title || ""));
  const wasDomestic = article.queryGroup === "korean_domestic_media" || article.domesticMedia === true;

  if (!isKoreanOriginal && !wasDomestic) return true;
  if (SPORTS_RE.test(raw)) {
    sportsRemoved += 1;
    return false;
  }
  if (!isApprovedDomesticArticle(article)) {
    unrelatedKoreanRemoved += 1;
    return false;
  }

  article.queryGroup = "korean_domestic_media";
  article.collectionLane = "korean_domestic_media";
  article.forcedCategory3 = "domestic_media";
  article.domesticMedia = true;
  article.domesticMediaReason = "승인된 국내 언론 검색어 일치";
  prepared += 1;
  return true;
});

payload.count = payload.articles.length;
payload.domesticMediaPreparation = {
  prepared,
  sportsRemoved,
  unrelatedKoreanRemoved,
  completedAt: new Date().toISOString()
};
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-media] prepared=${prepared}, sportsRemoved=${sportsRemoved}, unrelatedKoreanRemoved=${unrelatedKoreanRemoved}`);
