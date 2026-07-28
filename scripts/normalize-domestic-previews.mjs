#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "news.json");
const TIMEOUT = Number(process.env.DOMESTIC_PREVIEW_TIMEOUT_MS || 10000);

function decode(value = "") {
  return String(value)
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}
function clean(value = "") {
  return decode(String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/무단전재[^.。]*[.。]?|재배포[^.。]*[.。]?|Copyright[^.。]*[.。]?|저작권자[^.。]*[.。]?/gi, " ")
    .replace(/\s+/g, " ").trim();
}
function comparable(value = "") { return clean(value).toLowerCase().replace(/[^가-힣a-z0-9]/g, ""); }
function useful(value = "", title = "") {
  const text = clean(value);
  if (text.length < 45) return false;
  const a = comparable(text), b = comparable(title);
  if (!a) return false;
  if (b && (a === b || (a.startsWith(b) && a.length < b.length * 1.8))) return false;
  const titleWords = new Set(clean(title).split(/\s+/).filter((x) => x.length >= 2));
  const textWords = new Set(text.split(/\s+/).filter((x) => x.length >= 2));
  if (titleWords.size && [...titleWords].filter((x) => textWords.has(x)).length / titleWords.size > 0.9 && text.length < clean(title).length * 2) return false;
  return true;
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
function paragraphCandidates(html = "") {
  const out = [];
  for (const match of String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = clean(match[1]);
    if (text.length >= 55) out.push(text);
  }
  return out;
}
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.7"
      }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally { clearTimeout(timer); }
}
async function previewFromUrl(url, title) {
  if (!url) return "";
  try {
    const html = await fetchHtml(url);
    const candidates = [
      meta(html, "og:description"),
      meta(html, "twitter:description"),
      meta(html, "description"),
      ...paragraphCandidates(html)
    ];
    return candidates.map(clean).find((candidate) => useful(candidate, title)) || "";
  } catch { return ""; }
}

const payload = JSON.parse(await fs.readFile(FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
let updated = 0;
let usefulCount = 0;

for (const article of articles) {
  const domestic = article.domesticMedia === true || article.queryGroup === "korean_domestic_media" || article.category3 === "domestic_media";
  if (!domestic) continue;

  const related = Array.isArray(article.relatedNews) ? article.relatedNews : [];
  const localCandidates = [
    article.fullText,
    article.description,
    ...related.flatMap((item) => [item.fullText, item.description])
  ];
  let preview = localCandidates.map(clean).find((candidate) => useful(candidate, article.title)) || "";

  if (!preview) {
    const urls = [article.url, ...related.map((item) => item.url)].filter(Boolean).slice(0, 4);
    for (const url of urls) {
      preview = await previewFromUrl(url, article.title);
      if (preview) break;
    }
  }

  article.previewText = preview ? preview.slice(0, 420) : "기사의 상세 내용은 원문 보기에서 확인할 수 있습니다.";
  article.previewAvailable = Boolean(preview);
  if (preview) usefulCount += 1;
  updated += 1;
}

payload.domesticPreviewNormalization = { updated, usefulCount, generatedAt: new Date().toISOString() };
await fs.writeFile(FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-preview] updated=${updated}, useful=${usefulCount}`);
