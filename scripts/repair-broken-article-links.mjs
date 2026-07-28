#!/usr/bin/env node
/**
 * Repair article URLs that were accidentally populated with Google publisher
 * icon/image URLs. The repair queries Google News RSS by the stored headline
 * and stores a valid Google News article link when a close match is found.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const TIMEOUT_MS = Number(process.env.LINK_REPAIR_TIMEOUT_MS || 12000);
const CONCURRENCY = Number(process.env.LINK_REPAIR_CONCURRENCY || 3);

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .trim();
}

function stripTags(value = "") {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractTag(xml = "", tag = "") {
  const m = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeHtml(m[1]).trim() : "";
}

function isBrokenUrl(value = "") {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return true;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const pathName = u.pathname.toLowerCase();
    if (/(^|\.)lh\d*\.googleusercontent\.com$/.test(host)) return true;
    if (/(^|\.)gstatic\.com$/.test(host)) return true;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico)$/i.test(pathName)) return true;
    if (/googleusercontent\.com$/.test(host) && /(?:^|[?&])(w|h|sz)=\d+(?:&|$)/i.test(u.search)) return true;
    return false;
  } catch {
    return true;
  }
}

function normalizedTitle(value = "") {
  return stripTags(value)
    .replace(/\s+-\s+[^-]{1,50}$/u, "")
    .replace(/[‘’“”'"「」『』\[\](){}]/g, "")
    .replace(/[^0-9A-Za-z가-힣\u0600-\u06ff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function similarity(a = "", b = "") {
  const aa = new Set(normalizedTitle(a).split(" ").filter((x) => x.length > 1));
  const bb = new Set(normalizedTitle(b).split(" ").filter((x) => x.length > 1));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": "Mozilla/5.0 Weekly Report Link Repair",
        accept: "application/rss+xml,application/xml,text/xml,*/*"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseItems(xml = "") {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => ({
    title: extractTag(block, "title"),
    link: extractTag(block, "link"),
    description: extractTag(block, "description")
  })).filter((x) => x.title && /^https?:\/\//i.test(x.link));
}

async function repairOne(article) {
  const headline = String(article.title || article.titleKo || article.translatedTitle || "").trim();
  if (!headline) return article;

  const params = new URLSearchParams({
    q: `\"${headline.replace(/\"/g, "")}\" when:30d`,
    hl: "ko",
    gl: "KR",
    ceid: "KR:ko"
  });

  try {
    const xml = await fetchText(`https://news.google.com/rss/search?${params.toString()}`);
    const candidates = parseItems(xml)
      .map((item) => ({ ...item, score: similarity(headline, item.title) }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || best.score < 0.45) {
      return { ...article, linkRepairStatus: "not-found" };
    }
    return {
      ...article,
      url: best.link,
      resolvedUrl: best.link,
      linkRepairStatus: "google-news-restored",
      linkRepairedAt: new Date().toISOString()
    };
  } catch (error) {
    console.warn(`[link-repair] ${headline.slice(0, 90)} - ${error.message || error}`);
    return { ...article, linkRepairStatus: "failed" };
  }
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return out;
}

const raw = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const articles = Array.isArray(raw) ? raw : (raw.articles || raw.items || []);
const targets = articles.filter((article) => isBrokenUrl(article.resolvedUrl || article.canonicalUrl || article.articleUrl || article.sourceUrl || article.link || article.url));

if (!targets.length) {
  console.log("[link-repair] No broken article links found.");
  process.exit(0);
}

console.log(`[link-repair] Repairing ${targets.length} broken links...`);
const repaired = await mapLimit(targets, CONCURRENCY, repairOne);
const repairedById = new Map(targets.map((item, index) => [item, repaired[index]]));
const nextArticles = articles.map((item) => repairedById.get(item) || item);
const success = repaired.filter((x) => x.linkRepairStatus === "google-news-restored").length;

const output = Array.isArray(raw) ? nextArticles : { ...raw, articles: nextArticles };
await fs.writeFile(NEWS_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[link-repair] Restored ${success}/${targets.length} links.`);
