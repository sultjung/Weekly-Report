#!/usr/bin/env node
/**
 * Remove Gaza/Palestine/Hamas stories from the Middle East regional lane.
 *
 * The Weekly-Report scope intentionally excludes Gaza-focused coverage because
 * its volume overwhelms the Iraq/BNCP-relevant regional signals. This filter is
 * deterministic so broader Middle East searches cannot reintroduce those items.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const GAZA_RE = /قطاع\s+غزة|غزة|فلسطين|فلسطيني(?:ة|ون|ين)?|حماس|gaza(?:\s+strip)?|palestin(?:e|ian|ians)|hamas|가자(?:\s*지구)?|팔레스타인|하마스/iu;

function sourceText(article = {}) {
  return [
    article.title,
    article.description,
    String(article.cleanText || article.fullText || "").slice(0, 3500)
  ].filter(Boolean).join("\n");
}

export function isGazaRegionalArticle(article = {}) {
  return String(article.category3 || "") === "regional" && GAZA_RE.test(sourceText(article));
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
  const removed = [];
  const kept = [];

  for (const article of articles) {
    if (isGazaRegionalArticle(article)) {
      removed.push({
        id: article.id || "",
        title: article.titleKo || article.title || "",
        reason: "중동 주요 정세 수집 범위에서 가자·팔레스타인·하마스 관련 기사 제외"
      });
      continue;
    }
    kept.push(article);
  }

  payload.articles = kept;
  payload.count = kept.length;
  payload.counts = recalcCounts(kept);
  payload.gazaRegionalFilter = {
    appliedAt: new Date().toISOString(),
    removedCount: removed.length,
    removed: removed.slice(0, 100)
  };

  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.count = payload.count;
    index.counts = payload.counts;
    index.gazaRegionalFilter = {
      appliedAt: payload.gazaRegionalFilter.appliedAt,
      removedCount: removed.length
    };
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Gaza regional filter: kept=${kept.length}, removed=${removed.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
