#!/usr/bin/env node
/**
 * Group articles that report the same real-world event.
 *
 * This deliberately annotates articles instead of deleting them. The UI and
 * report generator can show one event while every original source remains
 * available through eventSources/eventArticles.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const STOPWORDS = new Set([
  "iraq", "iraqi", "العراق", "العراقي", "اليوم", "غدا", "بغداد", "baghdad",
  "이라크", "이라크의", "이라크가", "이라크는", "정부", "의회", "관련", "동향",
  "news", "خبر", "said", "says", "قال", "أعلن", "announced", "the", "and", "for"
]);

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value = "") {
  return new Set(clean(value).split(" ").filter((x) => x.length >= 2 && !STOPWORDS.has(x)));
}

function articleText(article = {}) {
  return [article.titleKo, article.title, article.summaryKo, article.description,
    article.reportBullet, article.weeklyReportReason, ...(article.reportSubBullets || []),
    ...(article.actors || []), article.location].filter(Boolean).join(" ");
}

function dateValue(article) {
  const value = new Date(article.publishedAt || article.date || 0).getTime();
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let common = 0;
  for (const token of a) if (b.has(token)) common += 1;
  return common / Math.min(a.size, b.size);
}

function sharedCount(a, b) {
  let count = 0;
  for (const token of a) if (b.has(token)) count += 1;
  return count;
}

function normalizeUrl(value = "") {
  try {
    const u = new URL(String(value));
    return `${u.hostname.replace(/^www\./i, "").toLowerCase()}${u.pathname.replace(/\/$/, "")}`;
  } catch { return String(value || "").toLowerCase(); }
}

function sourceRecord(article) {
  return {
    source: article.source || "",
    url: article.url || article.link || "",
    title: article.title || "",
    titleKo: article.titleKo || "",
    publishedAt: article.publishedAt || article.date || "",
    summaryKo: article.summaryKo || "",
    reportBullet: article.reportBullet || "",
    evidence: String(article.cleanText || article.fullText || article.description || "").slice(0, 1800)
  };
}

function canCompare(a, b) {
  if (!a || !b || a.category3 !== b.category3) return false;
  if (a.category3 === "exclude" || a.reportUsefulness === "exclude" || b.reportUsefulness === "exclude") return false;
  const dates = [dateValue(a), dateValue(b)].filter(Boolean);
  if (dates.length === 2 && Math.abs(dates[0] - dates[1]) > 48 * 60 * 60 * 1000) return false;
  return true;
}

function sameEvent(a, b) {
  if (!canCompare(a, b)) return false;
  const titleA = tokens(`${a.titleKo || ""} ${a.title || ""}`);
  const titleB = tokens(`${b.titleKo || ""} ${b.title || ""}`);
  const bodyA = tokens(articleText(a));
  const bodyB = tokens(articleText(b));
  const titleShared = sharedCount(titleA, titleB);
  const bodyShared = sharedCount(bodyA, bodyB);
  const titleOverlap = overlap(titleA, titleB);
  const bodyOverlap = overlap(bodyA, bodyB);
  const actorA = tokens([...(a.actors || []), a.location].join(" "));
  const actorB = tokens([...(b.actors || []), b.location].join(" "));
  const actorShared = sharedCount(actorA, actorB);
  const numberShared = sharedCount(new Set(clean(`${a.titleKo || ""} ${a.title || ""}`).match(/\d+/g) || []), new Set(clean(`${b.titleKo || ""} ${b.title || ""}`).match(/\d+/g) || []));

  // A strong title match is sufficient. Otherwise require multiple shared
  // factual tokens; this prevents all articles about the same politician or
  // country from being collapsed into one event.
  if (titleShared >= 4 && titleOverlap >= 0.45) return true;
  if (numberShared >= 1 && titleShared >= 3 && bodyShared >= 5 && bodyOverlap >= 0.32) return true;
  if (actorShared >= 2 && bodyShared >= 6 && bodyOverlap >= 0.35 && titleShared >= 2) return true;
  if (bodyShared >= 8 && bodyOverlap >= 0.50 && titleShared >= 3) return true;
  return false;
}

function hash(value = "") {
  let h = 2166136261;
  for (const c of String(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function eventId(group) {
  const primary = group.slice().sort((a, b) => String(a.id || "").localeCompare(String(b.id || "")))[0];
  const day = String(primary.publishedAt || primary.date || "").slice(0, 10) || "undated";
  const key = clean(`${primary.titleKo || primary.title || "event"} ${primary.category3 || ""}`).slice(0, 180);
  return `event-${day}-${hash(key)}`;
}

function quality(article) {
  return Number(article.importanceScore || 0)
    + (article.cleanText || article.fullText ? 20 : 0)
    + (article.url && !/news\.google\.com/i.test(article.url) ? 10 : 0)
    + Math.min(String(article.summaryKo || "").length / 50, 6);
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const sourceArticles = Array.isArray(payload.articles) ? payload.articles : [];
  const sorted = sourceArticles.slice().sort((a, b) => dateValue(a) - dateValue(b));
  const groups = [];

  for (const article of sorted) {
    const candidates = groups.filter((group) => group.some((existing) => sameEvent(article, existing)));
    let target = null;
    if (candidates.length) {
      target = candidates.sort((a, b) => b.length - a.length)[0];
    }
    if (target) target.push(article);
    else groups.push([article]);
  }

  const eventByObject = new Map();
  const eventMeta = [];
  for (const group of groups) {
    const representative = group.slice().sort((a, b) => quality(b) - quality(a))[0];
    const sources = [...new Map(group.map((item) => [normalizeUrl(item.url || item.link) || `${item.source}|${item.title}`, sourceRecord(item)])).values()];
    const id = eventId(group);
    const meta = {
      eventId: id,
      eventTitleKo: representative.titleKo || representative.title || "주요 동향",
      eventSummaryKo: representative.summaryKo || representative.description || "",
      eventArticleCount: group.length,
      eventSources: sources,
      eventArticles: group.map(sourceRecord),
      eventRepresentativeId: representative.id || ""
    };
    eventMeta.push(meta);
    for (const article of group) eventByObject.set(article, meta);
  }

  payload.articles = sourceArticles.map((article) => {
    const meta = eventByObject.get(article);
    const isRepresentative = meta?.eventRepresentativeId === (article.id || "");
    // Keep the full source list only once on the visible representative card;
    // non-representative raw articles retain their identity and eventId without
    // duplicating the entire source array throughout news.json.
    return isRepresentative
      ? { ...article, ...meta, eventRepresentative: true }
      : {
          ...article,
          eventId: meta?.eventId || "",
          eventTitleKo: meta?.eventTitleKo || "",
          eventSummaryKo: meta?.eventSummaryKo || "",
          eventArticleCount: meta?.eventArticleCount || 1,
          eventRepresentative: false
        };
  });
  payload.eventCount = eventMeta.length;
  payload.eventDuplicateArticleCount = sourceArticles.length - eventMeta.length;
  payload.eventGroupedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.eventCount = payload.eventCount;
    index.eventDuplicateArticleCount = payload.eventDuplicateArticleCount;
    index.eventGroupedAt = payload.eventGroupedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}
  console.log(`Grouped news events: articles=${sourceArticles.length}, events=${eventMeta.length}, grouped=${sourceArticles.length - eventMeta.length}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
