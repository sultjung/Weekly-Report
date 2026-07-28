#!/usr/bin/env node
/** Repair broken/search URLs and persist the final publisher article URL. */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const TIMEOUT_MS = Number(process.env.LINK_REPAIR_TIMEOUT_MS || 15000);
const CONCURRENCY = Number(process.env.LINK_REPAIR_CONCURRENCY || 3);

function decodeHtml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).trim();
}
function stripTags(value = "") { return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim(); }
function extractTag(xml = "", tag = "") { const m = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? decodeHtml(m[1]).trim() : ""; }
function hostOf(value = "") { try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function normalizeUrl(value = "") { try { const u = new URL(value); u.hash = ""; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k); return u.toString(); } catch { return ""; } }
function isPublisherUrl(value = "") {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw), host = u.hostname.toLowerCase(), p = u.pathname.toLowerCase();
    if (/(^|\.)lh\d*\.googleusercontent\.com$/.test(host) || /(^|\.)gstatic\.com$/.test(host)) return false;
    if (host === "news.google.com") return false;
    if (/(^|\.)google\.[a-z.]+$/.test(host) && /^\/search(\/|$)/.test(p)) return false;
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico)(?:$|[?#])/i.test(p)) return false;
    return true;
  } catch { return false; }
}
function needsRepair(article = {}) {
  const values = [article.resolvedUrl, article.canonicalUrl, article.articleUrl, article.sourceUrl, article.link, article.url].filter(Boolean);
  return !values.some(isPublisherUrl);
}
function normalizedTitle(value = "") {
  return stripTags(value).replace(/\s+-\s+[^-]{1,60}$/u, "").replace(/[‘’“”'"「」『』\[\](){}]/g, "")
    .replace(/[^0-9A-Za-z가-힣\u0600-\u06ff]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}
function similarity(a = "", b = "") {
  const aa = new Set(normalizedTitle(a).split(" ").filter(x => x.length > 1));
  const bb = new Set(normalizedTitle(b).split(" ").filter(x => x.length > 1));
  if (!aa.size || !bb.size) return 0;
  let common = 0; for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}
async function fetchResponse(url, accept = "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36", accept, "accept-language": "ko-KR,ko;q=0.9,en;q=0.8" } });
  } finally { clearTimeout(timer); }
}
async function fetchText(url) { const res = await fetchResponse(url); if (!res.ok) throw new Error(`HTTP ${res.status}`); return { text: await res.text(), finalUrl: res.url || url }; }
function parseItems(xml = "") {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map(block => ({ title: extractTag(block, "title"), link: extractTag(block, "link"), description: extractTag(block, "description"), source: stripTags(extractTag(block, "source")) })).filter(x => x.title && /^https?:\/\//i.test(x.link));
}
function extractPublisherUrlFromHtml(html = "", baseUrl = "") {
  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/i,
    /["'](?:url|articleUrl|canonicalUrl)["']\s*:\s*["'](https?:\\?\/\\?\/[^"']+)["']/i
  ];
  for (const re of patterns) {
    const m = String(html || "").match(re);
    if (!m?.[1]) continue;
    const decoded = decodeHtml(m[1]).replace(/\\\//g, "/");
    try { const absolute = new URL(decoded, baseUrl).toString(); if (isPublisherUrl(absolute)) return normalizeUrl(absolute); } catch {}
  }
  return "";
}
async function resolveIndividualGoogleLink(link = "") {
  try {
    const res = await fetchResponse(link);
    if (isPublisherUrl(res.url)) return normalizeUrl(res.url);
    const html = await res.text();
    return extractPublisherUrlFromHtml(html, res.url || link);
  } catch { return ""; }
}
async function repairOne(article) {
  const headline = String(article.title || article.titleKo || article.translatedTitle || "").trim();
  if (!headline) return { ...article, linkRepairStatus: "no-title" };
  const params = new URLSearchParams({ q: `"${headline.replace(/"/g, "")}" when:60d`, hl: "ko", gl: "KR", ceid: "KR:ko" });
  try {
    const { text: xml } = await fetchText(`https://news.google.com/rss/search?${params.toString()}`);
    const sourceName = String(article.source || "").toLowerCase();
    const candidates = parseItems(xml).map(item => {
      let value = similarity(headline, item.title);
      if (sourceName && String(item.source || item.title).toLowerCase().includes(sourceName)) value += 0.2;
      return { ...item, score: value };
    }).sort((a, b) => b.score - a.score);
    for (const candidate of candidates.slice(0, 5)) {
      if (candidate.score < 0.45) continue;
      const publisherUrl = await resolveIndividualGoogleLink(candidate.link);
      if (!publisherUrl) continue;
      return { ...article, url: publisherUrl, resolvedUrl: publisherUrl, canonicalUrl: publisherUrl, googleNewsUrl: candidate.link, linkRepairStatus: "publisher-url-restored", linkRepairedAt: new Date().toISOString() };
    }
    return { ...article, linkRepairStatus: "publisher-url-not-found" };
  } catch (error) {
    console.warn(`[link-repair] ${headline.slice(0, 90)} - ${error.message || error}`);
    return { ...article, linkRepairStatus: "failed" };
  }
}
async function mapLimit(items, limit, worker) {
  const out = new Array(items.length); let cursor = 0;
  async function run() { while (true) { const index = cursor++; if (index >= items.length) return; out[index] = await worker(items[index], index); } }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run)); return out;
}
const raw = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const articles = Array.isArray(raw) ? raw : (raw.articles || raw.items || []);
const targets = articles.filter(needsRepair);
if (!targets.length) { console.log("[link-repair] No article links need repair."); process.exit(0); }
console.log(`[link-repair] Resolving ${targets.length} publisher URLs...`);
const repaired = await mapLimit(targets, CONCURRENCY, repairOne);
const repairedByItem = new Map(targets.map((item, index) => [item, repaired[index]]));
const nextArticles = articles.map(item => repairedByItem.get(item) || item);
const success = repaired.filter(x => x.linkRepairStatus === "publisher-url-restored").length;
const output = Array.isArray(raw) ? nextArticles : { ...raw, articles: nextArticles };
await fs.writeFile(NEWS_FILE, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(`[link-repair] Restored final publisher URLs for ${success}/${targets.length} articles.`);
