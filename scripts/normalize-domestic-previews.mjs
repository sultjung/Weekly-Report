#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "news.json");
const TIMEOUT = Number(process.env.DOMESTIC_PREVIEW_TIMEOUT_MS || 12000);

function decode(value = "") {
  return String(value)
    .replace(/\\u0026/g, "&")
    .replace(/\\u003d/g, "=")
    .replace(/\\u002f/g, "/")
    .replace(/\\\//g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function clean(value = "") {
  return decode(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/무단전재[^.。]*[.。]?|재배포[^.。]*[.。]?|Copyright[^.。]*[.。]?|저작권자[^.。]*[.。]?/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
function comparable(value = "") {
  return clean(value).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
}
function useful(value = "", title = "") {
  const text = clean(value);
  if (text.length < 55) return false;
  const a = comparable(text), b = comparable(title);
  if (!a || !b) return Boolean(a);
  if (a === b) return false;
  if (a.startsWith(b) && a.length < b.length * 1.8) return false;
  const titleWords = new Set(clean(title).split(/\s+/).filter((x) => x.length >= 2));
  const textWords = new Set(text.split(/\s+/).filter((x) => x.length >= 2));
  if (titleWords.size && [...titleWords].filter((x) => textWords.has(x)).length / titleWords.size > 0.9 && text.length < clean(title).length * 2) return false;
  return true;
}
function host(url = "") {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function isGoogleNews(url = "") {
  return /(^|\.)news\.google\.com$/i.test(host(url));
}
function meta(html = "", key = "") {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const re of [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["']`, "i")
  ]) {
    const match = String(html).match(re);
    if (match) return clean(match[1]);
  }
  return "";
}
function jsonLdCandidates(html = "") {
  const out = [];
  for (const match of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(decode(match[1]));
      const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (stack.length) {
        const value = stack.pop();
        if (!value || typeof value !== "object") continue;
        for (const key of ["description", "articleBody", "text"]) if (typeof value[key] === "string") out.push(clean(value[key]));
        for (const child of Object.values(value)) {
          if (Array.isArray(child)) stack.push(...child);
          else if (child && typeof child === "object") stack.push(child);
        }
      }
    } catch {}
  }
  return out;
}
function paragraphCandidates(html = "") {
  const out = [];
  const scoped = [];
  for (const re of [
    /<div[^>]+id=["']dic_area["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]+id=["']harmonyContainer["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]+class=["'][^"']*(?:article-body|article_body|article-view|article_view|news-body|news_body|view-content|view_content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ]) for (const match of String(html).matchAll(re)) scoped.push(match[1]);
  const source = scoped.length ? scoped.join("\n") : String(html);
  for (const match of source.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = clean(match[1]);
    if (text.length >= 55) out.push(text);
  }
  return out;
}
function publisherUrlFromGoogle(html = "", currentUrl = "") {
  const currentHost = host(currentUrl);
  const candidates = [];
  for (const re of [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/gi,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/gi,
    /<a[^>]+href=["'](https?:\/\/[^"']+)["']/gi,
    /(https?:\\?\/\\?\/[^"'<>\s]+\.(?:com|net|co\.kr|kr|org|tv|news)[^"'<>\s]*)/gi
  ]) for (const match of String(html).matchAll(re)) candidates.push(decode(match[1]));
  return candidates.find((url) => {
    const candidateHost = host(url);
    return candidateHost && candidateHost !== currentHost &&
      !/(^|\.)google\.|gstatic\.com|youtube\.com|accounts\.google|doubleclick\.net/i.test(candidateHost);
  }) || "";
}
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { html: await response.text(), url: response.url || url };
  } finally { clearTimeout(timer); }
}
async function resolvePublisherPage(url) {
  const first = await fetchPage(url);
  if (!isGoogleNews(first.url)) return first;
  const publisher = publisherUrlFromGoogle(first.html, first.url);
  if (!publisher) return first;
  try { return await fetchPage(publisher); } catch { return first; }
}
function choosePreview(article, html = "") {
  const candidates = [
    meta(html, "og:description"),
    meta(html, "twitter:description"),
    meta(html, "description"),
    ...jsonLdCandidates(html),
    ...paragraphCandidates(html),
    article.fullText,
    article.description,
    ...(Array.isArray(article.relatedNews) ? article.relatedNews.flatMap((item) => [item.fullText, item.description]) : [])
  ];
  return candidates.map(clean).filter((value) => useful(value, article.title)).sort((a, b) => b.length - a.length)[0] || "";
}

const payload = JSON.parse(await fs.readFile(FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
let updated = 0;
let resolved = 0;
let usefulCount = 0;
let failed = 0;

for (const article of articles) {
  const domestic = article.domesticMedia === true || article.queryGroup === "korean_domestic_media" || article.category3 === "domestic_media";
  if (!domestic) continue;
  let html = "";
  if (article.url) {
    try {
      const page = await resolvePublisherPage(article.url);
      html = page.html;
      if (page.url && page.url !== article.url && !isGoogleNews(page.url)) {
        article.url = page.url;
        resolved += 1;
      }
    } catch { failed += 1; }
  }
  const preview = choosePreview(article, html);
  article.previewText = preview ? preview.slice(0, 520) : "기사의 상세 내용은 원문 보기에서 확인할 수 있습니다.";
  article.previewAvailable = Boolean(preview);
  if (preview) usefulCount += 1;
  updated += 1;
}

payload.domesticPreviewNormalization = { updated, resolved, usefulCount, failed, generatedAt: new Date().toISOString() };
await fs.writeFile(FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-preview] updated=${updated}, resolved=${resolved}, useful=${usefulCount}, failed=${failed}`);
