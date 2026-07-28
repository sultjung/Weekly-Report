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
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
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
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text: await res.text(), url: res.url || url };
  } finally { clearTimeout(timer); }
}
function rssUrl(query) {
  const params = new URLSearchParams({ q: `${query} when:${DAYS}d`, hl: "ko", gl: "KR", ceid: "KR:ko" });
  return `https://news.google.com/rss/search?${params}`;
}
function parseRss(xml, query) {
  return (String(xml).match(/<item>[\s\S]*?<\/item>/gi) || []).slice(0, MAX_PER_QUERY).map((block) => {
    const rawTitle = tag(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? stripTags(sourceMatch[1]) : (rawTitle.split(" - ").pop() || "Google News");
    const title = rawTitle.replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "").trim();
    const pubDate = tag(block, "pubDate");
    return { title, source, publishedAt: pubDate ? new Date(pubDate).toISOString() : "", url: tag(block, "link"), description: stripTags(tag(block, "description")), query };
  }).filter((x) => x.title && x.url);
}
function allowed(item) {
  const t = `${item.title} ${item.description}`;
  if (SPORTS_RE.test(t)) return false;
  return /비스마야/u.test(t) || /이라크/u.test(t) || (/한화/u.test(t) && /김동관/u.test(t)) || (/한화/u.test(t) && /김동선/u.test(t));
}
function cleanArticleText(value = "", title = "") {
  let text = stripTags(value)
    .replace(/무단전재[^\n]*|재배포[^\n]*|Copyright[^\n]*|저작권자[^\n]*/gi, " ")
    .replace(/기자\s*=|특파원\s*=/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  const normalizedTitle = String(title).replace(/\s+/g, " ").trim();
  if (normalizedTitle && text.startsWith(normalizedTitle)) text = text.slice(normalizedTitle.length).trim();
  return text;
}
function validArticleText(text = "", title = "") {
  const compact = String(text).replace(/\s+/g, " ").trim();
  if (compact.length < MIN_FULLTEXT_CHARS) return false;
  const titleCompact = String(title).replace(/\s+/g, " ").trim();
  if (titleCompact && compact.length < titleCompact.length * 2.2) return false;
  return true;
}
function jsonNodes(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(jsonNodes);
  if (typeof value !== "object") return [];
  return [value, ...Object.values(value).flatMap(jsonNodes)];
}
function extractJsonArticleBodies(html = "", title = "") {
  const candidates = [];
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decodeHtml(m[1]).trim());
      for (const node of jsonNodes(parsed)) {
        for (const key of ["articleBody", "description", "text"]) {
          if (typeof node?.[key] === "string") candidates.push(node[key]);
        }
      }
    } catch {}
  }
  for (const pattern of [
    /["']articleBody["']\s*:\s*["']((?:\\.|[^"']){300,})["']/gi,
    /["']article_body["']\s*:\s*["']((?:\\.|[^"']){300,})["']/gi,
    /["']body["']\s*:\s*["']((?:\\.|[^"']){500,})["']/gi
  ]) {
    for (const m of String(html).matchAll(pattern)) {
      try { candidates.push(JSON.parse(`"${m[1].replace(/"/g, '\\"')}"`)); } catch { candidates.push(m[1].replace(/\\n/g, "\n").replace(/\\"/g, '"')); }
    }
  }
  return candidates.map((x) => cleanArticleText(x, title)).filter((x) => validArticleText(x, title));
}
function extractSelectorBodies(html = "", title = "") {
  const candidates = [];
  const patterns = [
    /<div[^>]+id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]+id=["']newsct_article["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]+id=["']harmonyContainer["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section[^>]+dmcf-sid=["'][^"']+["'][^>]*>([\s\S]*?)<\/section>/gi,
    /<div[^>]+class=["'][^"']*(?:article_view|article-body|article_body|articleBody|news_body|news-body|view_content|view-content|story-body|content-body|article-content|article_txt|article-text)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi
  ];
  for (const re of patterns) for (const m of String(html).matchAll(re)) candidates.push(cleanArticleText(m[1], title));
  return candidates.filter((x) => validArticleText(x, title));
}
function extractMetaContent(html = "", name = "") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ];
  for (const re of patterns) { const m = String(html).match(re); if (m) return decodeHtml(m[1]); }
  return "";
}
function extractExternalArticleUrl(html = "", currentUrl = "") {
  const currentHost = hostnameOf(currentUrl);
  const candidates = [];
  for (const re of [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"']+)["']/gi,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi
  ]) for (const m of String(html).matchAll(re)) candidates.push(decodeHtml(m[1]));
  return candidates.find((url) => {
    const host = hostnameOf(url);
    return host && host !== currentHost && !/(^|\.)google\.|gstatic\.com|youtube\.com|accounts\.google/i.test(host);
  }) || "";
}
function extractArticleText(html = "", title = "") {
  const candidates = [...extractJsonArticleBodies(html, title), ...extractSelectorBodies(html, title)];
  const metaDescription = cleanArticleText(extractMetaContent(html, "og:description") || extractMetaContent(html, "description"), title);
  if (validArticleText(metaDescription, title)) candidates.push(metaDescription);
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
}
async function hydrate(item) {
  try {
    const first = await fetchText(item.url);
    let articleUrl = first.url;
    let html = first.text;
    if (/news\.google\.com/i.test(hostnameOf(articleUrl))) {
      const external = extractExternalArticleUrl(html, articleUrl);
      if (external) {
        const second = await fetchText(external);
        articleUrl = second.url;
        html = second.text;
      }
    }
    const fullText = extractArticleText(html, item.title);
    const preview = item.description || cleanArticleText(extractMetaContent(html, "og:description") || extractMetaContent(html, "description"), item.title);
    return {
      ...item,
      url: articleUrl,
      fullText,
      description: preview || fullText.slice(0, 320),
      fullTextAvailable: validArticleText(fullText, item.title),
      fullTextChars: fullText.length
    };
  } catch (error) {
    return { ...item, fullText: "", fullTextAvailable: false, fullTextError: String(error.message || error) };
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
    group.sort((a, b) => Number(b.fullTextAvailable) - Number(a.fullTextAvailable) || b.fullTextChars - a.fullTextChars || new Date(b.publishedAt) - new Date(a.publishedAt));
    const [main, ...related] = group;
    return {
      id: stableId(main.url || main.title),
      title: main.title,
      titleKo: main.title,
      source: main.source,
      publishedAt: main.publishedAt,
      url: main.url,
      description: main.description,
      fullText: main.fullText || "",
      fullTextAvailable: Boolean(main.fullTextAvailable),
      fullTextChars: Number(main.fullTextChars || 0),
      query: main.query,
      queryGroup: "korean_domestic_media",
      collectionLane: "korean_domestic_media",
      category3: "domestic_media",
      domesticMedia: true,
      importanceScore: 70,
      reportUsefulness: "include",
      weeklyReportReason: "Google News RSS 국내 언론 키워드 수집",
      relatedNews: related.map((x) => ({ title: x.title, source: x.source, publishedAt: x.publishedAt, url: x.url, description: x.description, fullText: x.fullText || "", fullTextAvailable: Boolean(x.fullTextAvailable) })),
      relatedNewsCount: related.length
    };
  });
}

const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const existing = Array.isArray(payload.articles) ? payload.articles : [];
const collected = [];
for (const query of QUERIES) {
  try {
    const { text } = await fetchText(rssUrl(query));
    const items = parseRss(text, query).filter(allowed);
    console.log(`[domestic-rss] ${query}: ${items.length}`);
    collected.push(...items);
  } catch (error) { console.warn(`[domestic-rss] ${query}: ${error.message}`); }
}
const unique = [...new Map(collected.map((x) => [x.url || x.title, x])).values()];
const hydrated = [];
for (let i = 0; i < unique.length; i += 4) hydrated.push(...await Promise.all(unique.slice(i, i + 4).map(hydrate)));
const domestic = groupArticles(hydrated);
const nonDomestic = existing.filter((x) => !(x.domesticMedia || x.queryGroup === "korean_domestic_media" || x.collectionLane === "korean_domestic_media" || /[가-힣]/.test(String(x.title || ""))));
payload.articles = [...domestic, ...nonDomestic];
payload.count = payload.articles.length;
payload.domesticMedia = {
  count: domestic.length,
  rawCount: hydrated.length,
  fullTextCount: hydrated.filter((x) => x.fullTextAvailable).length,
  fullTextFailedCount: hydrated.filter((x) => !x.fullTextAvailable).length,
  queries: QUERIES,
  generatedAt: new Date().toISOString(),
  aiUsed: false
};
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-rss] grouped=${domestic.length}, raw=${hydrated.length}, fulltext=${payload.domesticMedia.fullTextCount}`);
