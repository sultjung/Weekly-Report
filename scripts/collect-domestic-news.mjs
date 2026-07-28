#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const DAYS = Number(process.env.DOMESTIC_NEWS_DAYS || 7);
const MAX_PER_QUERY = Number(process.env.DOMESTIC_MAX_PER_QUERY || 50);
const FETCH_TIMEOUT_MS = Number(process.env.DOMESTIC_FETCH_TIMEOUT_MS || 12000);

const QUERIES = ["비스마야", "한화 이라크", "이라크", "한화 김동관", "한화 김동선"];
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
  return decodeHtml(String(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function tag(xml, name) {
  const m = String(xml).match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeHtml(m[1]).trim() : "";
}
function stableId(value) {
  return `domestic-${createHash("sha256").update(String(value)).digest("base64url").slice(0, 24)}`;
}
async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 Weekly Report Domestic News", accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
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
function extractArticleText(html = "") {
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(decodeHtml(m[1]));
      const nodes = Array.isArray(data) ? data : data?.["@graph"] || [data];
      for (const node of nodes) if (typeof node?.articleBody === "string" && node.articleBody.length > 200) return node.articleBody.replace(/\s+/g, " ").trim();
    } catch {}
  }
  const article = String(html).match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1] || "";
  const cleaned = stripTags(article);
  return cleaned.length > 200 ? cleaned : "";
}
async function hydrate(item) {
  try {
    const first = await fetchText(item.url);
    const fullText = extractArticleText(first.text);
    return { ...item, url: first.url, fullText, description: item.description || fullText.slice(0, 320) };
  } catch { return item; }
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
      query: main.query,
      queryGroup: "korean_domestic_media",
      collectionLane: "korean_domestic_media",
      category3: "domestic_media",
      domesticMedia: true,
      importanceScore: 70,
      reportUsefulness: "include",
      weeklyReportReason: "Google News RSS 국내 언론 키워드 수집",
      relatedNews: related.map((x) => ({ title: x.title, source: x.source, publishedAt: x.publishedAt, url: x.url, description: x.description, fullText: x.fullText || "" })),
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
for (let i = 0; i < unique.length; i += 5) hydrated.push(...await Promise.all(unique.slice(i, i + 5).map(hydrate)));
const domestic = groupArticles(hydrated);
const nonDomestic = existing.filter((x) => !(x.domesticMedia || x.queryGroup === "korean_domestic_media" || x.collectionLane === "korean_domestic_media" || /[가-힣]/.test(String(x.title || ""))));
payload.articles = [...domestic, ...nonDomestic];
payload.count = payload.articles.length;
payload.domesticMedia = { count: domestic.length, rawCount: hydrated.length, queries: QUERIES, generatedAt: new Date().toISOString(), aiUsed: false };
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-rss] grouped=${domestic.length}, raw=${hydrated.length}`);
