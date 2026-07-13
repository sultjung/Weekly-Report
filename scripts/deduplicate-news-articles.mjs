#!/usr/bin/env node
/**
 * Deduplicate collected news articles before publishing data/news.json.
 *
 * Why:
 * - The same article can enter through a direct source crawl, Google News RSS, and cached/redirected URLs.
 * - Known corrections can make duplicate source entries look identical on the site.
 * - For weekly reporting, duplicated cards are worse than missing a duplicate source.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function normalizeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\s\u00a0]+/g, " ")
    .replace(/["'“”‘’.,،؛:：()\[\]{}<>]/g, "")
    .trim();
}

function canonicalUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    let pathname = url.pathname.replace(/\/+$/g, "");
    if (host.includes("964media.com")) {
      const m = pathname.match(/\/(\d+)(?:\/)?$/);
      if (m) pathname = `/${m[1]}`;
    }
    if (host.includes("ninanews.com")) {
      const key = url.searchParams.get("Key") || url.searchParams.get("key");
      if (key) return `${host}/website/news/details?key=${key}`;
    }
    return `${host}${pathname}`.toLowerCase();
  } catch {
    return raw.toLowerCase().replace(/[?#].*$/g, "").replace(/\/+$/g, "");
  }
}

function fullArticleText(article = {}) {
  return [
    article.source,
    article.titleKo,
    article.title,
    article.summaryKo,
    article.description,
    article.weeklyReportReason,
    article.reportBullet,
    ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
    article.reportImplication,
    ...(Array.isArray(article.actors) ? article.actors : []),
    article.location
  ].filter(Boolean).join(" ");
}

function isMalikiAntiCorruptionDuplicate(article = {}) {
  const x = normalizeText(fullArticleText(article));
  return /(?:nouri\s*)?al[- ]?maliki|말리키|المالكي/.test(x)
    && /al[- ]?zaidi|자이디|الزيدي|반부패/.test(x)
    && /al[- ]?sudani|前\s*정부|전\s*정부|السوداني|약탈|فرهود|부패|فساد/.test(x)
    && /반부패|corruption|مكافحة الفساد|부패|فساد/.test(x);
}

function articleSignature(article = {}) {
  const source = normalizeText(article.source || "");
  const title = normalizeText(article.titleKo || article.title || "");
  const bullet = normalizeText(article.reportBullet || "");
  const summary = normalizeText(article.summaryKo || article.description || "");

  // Content-level known duplicates must be checked before URL.
  // The same story may be collected with different URLs/dates/caches but should appear once.
  if (isMalikiAntiCorruptionDuplicate(article)) {
    return "known:maliki-anti-corruption-interview";
  }

  const url = canonicalUrl(article.url || article.link || "");
  if (url) return `url:${url}`;

  if (source && title && bullet && title.length >= 14 && bullet.length >= 18) {
    return `content:${source}|${title}|${bullet}`;
  }

  return `loose:${source}|${title}|${summary.slice(0, 160)}`;
}

function publishedTime(article = {}) {
  const d = new Date(article.publishedAt || article.date || 0);
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime();
}

function qualityScore(article = {}) {
  let score = 0;
  const url = canonicalUrl(article.url || article.link || "");
  if (url && !/news\.google\.com|google\.com\/url/.test(url)) score += 20;
  if (article.titleKo && !/[\u0600-\u06FF]/.test(article.titleKo)) score += 10;
  if (article.summaryKo && !/[\u0600-\u06FF]/.test(article.summaryKo)) score += 10;
  score += Math.min(String(article.summaryKo || "").length / 100, 8);
  score += Math.min(Number(article.importanceScore || 0) / 10, 10);
  if (article.knownPoliticalSummaryFixed || article.glossaryApplied) score += 5;
  return score;
}

function chooseBetter(a, b) {
  const aSig = articleSignature(a);
  const bSig = articleSignature(b);
  const aTime = publishedTime(a);
  const bTime = publishedTime(b);

  // For known duplicate stories, earliest published date is usually the true source date.
  if (aSig === "known:maliki-anti-corruption-interview" && bSig === aSig && aTime !== bTime) {
    return bTime < aTime ? b : a;
  }

  const aScore = qualityScore(a);
  const bScore = qualityScore(b);
  if (Math.abs(aScore - bScore) >= 8) return bScore > aScore ? b : a;
  if (aTime !== bTime) return bTime < aTime ? b : a;
  return bScore > aScore ? b : a;
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
  const byKey = new Map();
  const duplicateGroups = [];

  for (const article of articles) {
    const key = articleSignature(article);
    if (!byKey.has(key)) {
      byKey.set(key, { article, duplicates: [] });
      continue;
    }
    const group = byKey.get(key);
    group.duplicates.push(article);
    group.article = chooseBetter(group.article, article);
  }

  const deduped = [...byKey.values()].map((group) => {
    if (group.duplicates.length) {
      duplicateGroups.push(group);
      return {
        ...group.article,
        duplicateCollapsed: true,
        duplicateCollapsedCount: group.duplicates.length + 1
      };
    }
    return group.article;
  });

  deduped.sort((a, b) => {
    const bt = publishedTime(b);
    const at = publishedTime(a);
    if (bt !== at) return bt - at;
    return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
  });

  payload.articles = deduped;
  payload.counts = recalcCounts(deduped);
  payload.duplicateCollapsedCount = articles.length - deduped.length;
  payload.duplicateCollapsedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.duplicateCollapsedCount = payload.duplicateCollapsedCount;
    index.duplicateCollapsedAt = payload.duplicateCollapsedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Deduplicated news articles: ${articles.length} -> ${deduped.length}, removed=${articles.length - deduped.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
