#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const KEYWORDS_FILE = path.join(ROOT, "data", "domestic-search-keywords.json");
const DAYS = Number(process.env.DOMESTIC_NEWS_DAYS || 7);
const MAX_PER_QUERY = Number(process.env.DOMESTIC_MAX_PER_QUERY || 50);
const FETCH_TIMEOUT_MS = Number(process.env.DOMESTIC_FETCH_TIMEOUT_MS || 15000);
const MIN_FULLTEXT_CHARS = Number(process.env.DOMESTIC_MIN_FULLTEXT_CHARS || 350);
const CONCURRENCY = Number(process.env.DOMESTIC_FETCH_CONCURRENCY || 4);

const keywordConfig = JSON.parse(await fs.readFile(KEYWORDS_FILE, "utf8"));
const QUERIES = Array.isArray(keywordConfig.queries) ? keywordConfig.queries : [];
const SPORTS_RE = /축구|농구|배구|야구|골프|테니스|월드컵|아시안컵|올림픽|대표팀|선수|감독|리그|득점|경기\s*(?:결과|일정|중계)|football|soccer|baseball|basketball|volleyball|golf|tennis|world cup|match|fixture|league/iu;

function decodeHtml(value = "") {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function stripTags(value = "") {
  return decodeHtml(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}
function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeHtml(m[1]).trim() : "";
}
function stableId(value) {
  return `domestic-${createHash("sha256").update(String(value)).digest("base64url").slice(0, 24)}`;
}
function hostnameOf(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function normalizeUrl(value = "") {
  try {
    const u = new URL(decodeHtml(value).trim());
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key);
    u.hash = "";
    return u.toString();
  } catch { return ""; }
}
function isGoogleHost(host = "") {
  return /(^|\.)(?:google\.com|google\.co\.kr|news\.google\.com|googleusercontent\.com|gstatic\.com)$/i.test(host);
}
function isPublisherUrl(value = "") {
  const url = normalizeUrl(value);
  if (!url) return false;
  try {
    const u = new URL(url);
    if (isGoogleHost(u.hostname)) return false;
    if (/\.(?:jpg|jpeg|png|gif|webp|svg|ico)(?:$|[?#])/i.test(u.pathname)) return false;
    return true;
  } catch { return false; }
}
async function fetchPage(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: options.method || "GET",
      body: options.body,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        accept: options.accept || "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
        ...(options.headers || {})
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), url: normalizeUrl(res.url || url) };
  } finally { clearTimeout(timer); }
}
function rssUrl(query) {
  const params = new URLSearchParams({ q: `${query} when:${DAYS}d`, hl: "ko", gl: "KR", ceid: "KR:ko" });
  return `https://news.google.com/rss/search?${params}`;
}
function parseRss(xml, query) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, MAX_PER_QUERY).map((block) => {
    const rawTitle = tag(block, "title");
    const sourceBlock = block.match(/<source([^>]*)>([\s\S]*?)<\/source>/i);
    const source = sourceBlock ? stripTags(sourceBlock[2]) : (rawTitle.split(" - ").pop() || "Google News");
    const sourceUrl = normalizeUrl((sourceBlock?.[1]?.match(/url=["']([^"']+)["']/i) || [])[1] || "");
    const title = rawTitle.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
    const pubDate = tag(block, "pubDate");
    const googleNewsUrl = normalizeUrl(tag(block, "link"));
    return { title, source, sourceUrl, publishedAt: pubDate ? new Date(pubDate).toISOString() : "", googleNewsUrl, url: "", description: stripTags(tag(block, "description")), query };
  }).filter((x) => x.title && x.googleNewsUrl);
}
function allowed(item) {
  const t = `${item.title} ${item.description}`;
  if (SPORTS_RE.test(t)) return false;
  return /비스마야/u.test(t) || /이라크/u.test(t) || (/한화/u.test(t) && /김동관/u.test(t)) || (/한화/u.test(t) && /김동선/u.test(t));
}
function extractMetaContent(html = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ]) { const m = String(html).match(re); if (m) return decodeHtml(m[1]); }
  return "";
}
function extractPublisherUrl(html = "", currentUrl = "") {
  const candidates = [];
  for (const re of [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi,
    /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/gi,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:url["']/gi,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/gi,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi
  ]) for (const m of String(html).matchAll(re)) candidates.push(normalizeUrl(m[1]));
  return candidates.find((url) => isPublisherUrl(url) && hostnameOf(url) !== hostnameOf(currentUrl)) || "";
}
function googleArticleId(url = "") {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const index = parts.findIndex((x) => x === "articles" || x === "read");
    return index >= 0 ? parts[index + 1] || "" : "";
  } catch { return ""; }
}
async function decodeGoogleNewsBatch(googleUrl, html = "") {
  const id = googleArticleId(googleUrl);
  if (!id) return "";
  const signature = (String(html).match(/data-n-a-sg=["']([^"']+)["']/i) || [])[1] || "";
  const timestamp = (String(html).match(/data-n-a-ts=["']([^"']+)["']/i) || [])[1] || "";
  if (!signature || !timestamp) return "";
  const inner = JSON.stringify(["garturlreq", [["ko", "KR", ["FINANCE_TOP_INDICES", "WEB_TEST_1_0_0"], null, null, 1, 1, "KR:ko", null, 180, null, null, null, null, null, 0, null, null, [1608992183, 723341000]], "ko", "KR", 1, [2, 3, 4, 8], 1, 0, "655000234", 0, 0, null, 0], id, Number(timestamp), signature]);
  const fReq = JSON.stringify([[["Fbv4je", inner, null, "generic"]]]);
  const body = new URLSearchParams({ "f.req": fReq }).toString();
  try {
    const result = await fetchPage("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
      method: "POST",
      body,
      accept: "*/*",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", origin: "https://news.google.com", referer: googleUrl }
    });
    const decoded = result.text.replace(/\\u003d/g, "=").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    const urls = [...decoded.matchAll(/https?:\/\/[^"\\\s]+/g)].map((m) => normalizeUrl(m[0]));
    return urls.find(isPublisherUrl) || "";
  } catch { return ""; }
}
async function resolvePublisherUrl(item) {
  if (isPublisherUrl(item.url)) return { publisherUrl: normalizeUrl(item.url), resolution: "existing" };
  try {
    const first = await fetchPage(item.googleNewsUrl);
    if (isPublisherUrl(first.url)) return { publisherUrl: first.url, resolution: "redirect" };
    const fromHtml = extractPublisherUrl(first.text, first.url);
    if (fromHtml) return { publisherUrl: fromHtml, resolution: "google-html" };
    const fromBatch = await decodeGoogleNewsBatch(item.googleNewsUrl, first.text);
    if (fromBatch) return { publisherUrl: fromBatch, resolution: "google-batchexecute" };
  } catch (error) {
    return { publisherUrl: "", resolution: "failed", error: String(error.message || error) };
  }
  return { publisherUrl: "", resolution: "unresolved" };
}
function cleanArticleText(value = "", title = "") {
  let text = stripTags(value)
    .replace(/무단전재[^\n]*|재배포[^\n]*|Copyright[^\n]*|저작권자[^\n]*/gi, " ")
    .replace(/기자\s*=|특파원\s*=/g, " ")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  const normalizedTitle = String(title).replace(/\s+/g, " ").trim();
  if (normalizedTitle && text.startsWith(normalizedTitle)) text = text.slice(normalizedTitle.length).trim();
  return text;
}
function validArticleText(text = "", title = "") {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (compact.length < MIN_FULLTEXT_CHARS) return false;
  const titleCompact = String(title).replace(/\s+/g, " ").trim();
  return !(titleCompact && compact.length < titleCompact.length * 2.2);
}
function jsonNodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonNodes);
  if (typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(jsonNodes)];
}
function extractArticleText(html = "", title = "") {
  const candidates = [];
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const node of jsonNodes(JSON.parse(decodeHtml(m[1]).trim()))) {
        for (const key of ["articleBody", "description", "text"]) if (typeof node?.[key] === "string") candidates.push(cleanArticleText(node[key], title));
      }
    } catch {}
  }
  for (const re of [
    /<div[^>]+id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]+id=["']newsct_article["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]+id=["']harmonyContainer["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section[^>]+dmcf-sid=["'][^"']+["'][^>]*>([\s\S]*?)<\/section>/gi,
    /<div[^>]+class=["'][^"']*(?:article_view|article-body|article_body|articleBody|news_body|news-body|view_content|view-content|story-body|content-body|article-content|article_txt|article-text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi
  ]) for (const m of String(html).matchAll(re)) candidates.push(cleanArticleText(m[1], title));
  const meta = cleanArticleText(extractMetaContent(html, "og:description") || extractMetaContent(html, "description"), title);
  if (validArticleText(meta, title)) candidates.push(meta);
  return candidates.filter((x) => validArticleText(x, title)).sort((a, b) => b.length - a.length)[0] || "";
}
async function hydrate(item) {
  const resolved = await resolvePublisherUrl(item);
  if (!resolved.publisherUrl) {
    return { ...item, url: "", resolvedUrl: "", linkResolutionStatus: resolved.resolution, linkResolutionError: resolved.error || "", fullText: "", fullTextAvailable: false, fullTextChars: 0 };
  }
  try {
    const page = await fetchPage(resolved.publisherUrl);
    const canonical = extractPublisherUrl(page.text, page.url);
    const publisherUrl = isPublisherUrl(canonical) ? canonical : page.url;
    const fullText = extractArticleText(page.text, item.title);
    const preview = cleanArticleText(extractMetaContent(page.text, "og:description") || extractMetaContent(page.text, "description"), item.title);
    return {
      ...item,
      url: publisherUrl,
      resolvedUrl: publisherUrl,
      canonicalUrl: publisherUrl,
      linkResolutionStatus: resolved.resolution,
      fullText,
      description: preview || item.description || fullText.slice(0, 320),
      fullTextAvailable: validArticleText(fullText, item.title),
      fullTextChars: fullText.length
    };
  } catch (error) {
    return { ...item, url: resolved.publisherUrl, resolvedUrl: resolved.publisherUrl, canonicalUrl: resolved.publisherUrl, linkResolutionStatus: `${resolved.resolution}-content-failed`, fullText: "", fullTextAvailable: false, fullTextChars: 0, fullTextError: String(error.message || error) };
  }
}
function normalizeTitle(title = "") {
  return String(title).toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/2분기|2q|전년(?:\s*대비)?|지난해|올해|억원|조원|급증|증가|감소|기록|공시|밝혀/g, " ").replace(/[^가-힣a-z0-9]+/g, " ").trim();
}
function tokens(title = "") { return new Set(normalizeTitle(title).split(/\s+/).filter((x) => x.length >= 2)); }
function similarity(a, b) {
  const A = tokens(a), B = tokens(b); if (!A.size || !B.size) return 0;
  let common = 0; for (const x of A) if (B.has(x)) common++;
  return common / Math.min(A.size, B.size);
}
function groupArticles(items) {
  const groups = [];
  for (const item of items.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))) {
    let group = groups.find((g) => similarity(g[0].title, item.title) >= 0.55);
    if (!group) { group = []; groups.push(group); }
    group.push(item);
  }
  return groups.map((group) => {
    group.sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)) || Number(b.fullTextAvailable) - Number(a.fullTextAvailable) || b.fullTextChars - a.fullTextChars || new Date(b.publishedAt) - new Date(a.publishedAt));
    const [main, ...related] = group;
    const mapRelated = (x) => ({ title: x.title, source: x.source, publishedAt: x.publishedAt, url: x.url || "", resolvedUrl: x.resolvedUrl || "", googleNewsUrl: x.googleNewsUrl || "", description: x.description, fullText: x.fullText || "", fullTextAvailable: Boolean(x.fullTextAvailable), linkResolutionStatus: x.linkResolutionStatus || "" });
    return {
      id: stableId(main.url || main.googleNewsUrl || main.title),
      title: main.title,
      titleKo: main.title,
      source: main.source,
      sourceUrl: main.sourceUrl || "",
      publishedAt: main.publishedAt,
      url: main.url || "",
      resolvedUrl: main.resolvedUrl || "",
      canonicalUrl: main.canonicalUrl || "",
      googleNewsUrl: main.googleNewsUrl || "",
      linkResolutionStatus: main.linkResolutionStatus || "unresolved",
      description: main.description,
      fullText: main.fullText || "",
      fullTextAvailable: Boolean(main.fullTextAvailable),
      fullTextChars: Number(main.fullTextChars || 0),
      query: main.query,
      queryGroup: "korean_domestic_media",
      collectionLane: "korean_domestic_media",
      collectionMethod: "google-news-rss-publisher-resolved",
      category3: "domestic_media",
      domesticMedia: true,
      importanceScore: 70,
      reportUsefulness: "include",
      weeklyReportReason: "Google News RSS 국내 언론 키워드 수집·언론사 원문 URL 확정",
      relatedNews: related.map(mapRelated),
      relatedNewsCount: related.length
    };
  });
}
async function mapLimit(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, run));
  return output;
}

const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const existing = Array.isArray(payload.articles) ? payload.articles : [];
const collected = [];
for (const query of QUERIES) {
  try {
    const { text } = await fetchPage(rssUrl(query));
    const items = parseRss(text, query).filter(allowed);
    console.log(`[domestic-rss] ${query}: ${items.length}`);
    collected.push(...items);
  } catch (error) { console.warn(`[domestic-rss] ${query}: ${error.message}`); }
}
const unique = [...new Map(collected.map((x) => [x.googleNewsUrl || x.title, x])).values()];
const hydrated = await mapLimit(unique, CONCURRENCY, hydrate);
const domestic = groupArticles(hydrated);
const nonDomestic = existing.filter((x) => !(x.domesticMedia || x.queryGroup === "korean_domestic_media" || x.collectionLane === "korean_domestic_media" || /[가-힣]/.test(String(x.title || ""))));
payload.articles = [...domestic, ...nonDomestic];
payload.count = payload.articles.length;
payload.domesticMedia = {
  count: domestic.length,
  rawCount: hydrated.length,
  directUrlCount: hydrated.filter((x) => isPublisherUrl(x.url)).length,
  unresolvedUrlCount: hydrated.filter((x) => !isPublisherUrl(x.url)).length,
  fullTextCount: hydrated.filter((x) => x.fullTextAvailable).length,
  fullTextFailedCount: hydrated.filter((x) => !x.fullTextAvailable).length,
  queries: QUERIES,
  generatedAt: new Date().toISOString(),
  aiUsed: false
};
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-rss] grouped=${domestic.length}, raw=${hydrated.length}, directUrls=${payload.domesticMedia.directUrlCount}, unresolved=${payload.domesticMedia.unresolvedUrlCount}, fulltext=${payload.domesticMedia.fullTextCount}`);