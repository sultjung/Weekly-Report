#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "news.json");
const TIMEOUT = Number(process.env.DOMESTIC_PREVIEW_TIMEOUT_MS || 10000);

function decode(value = "") {
  return String(value)
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
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}
function comparable(value = "") {
  return clean(value).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
}
function useful(value = "", title = "") {
  const text = clean(value);
  if (text.length < 45) return false;
  const a = comparable(text), b = comparable(title);
  if (!a || !b) return true;
  if (a === b || a.startsWith(b) && a.length < b.length * 1.6) return false;
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
function firstParagraph(html = "") {
  const candidates = [];
  for (const match of String(html).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = clean(match[1]);
    if (text.length >= 60) candidates.push(text);
  }
  return candidates.sort((a, b) => b.length - a.length)[0] || "";
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
  } finally {
    clearTimeout(timer);
  }
}

const payload = JSON.parse(await fs.readFile(FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
let updated = 0;

for (const article of articles) {
  const domestic = article.domesticMedia === true || article.queryGroup === "korean_domestic_media" || article.category3 === "domestic_media";
  if (!domestic) continue;

  let preview = useful(article.description, article.title) ? clean(article.description) : "";
  if (!preview && useful(article.fullText, article.title)) preview = clean(article.fullText).slice(0, 360);

  if (!preview && article.url) {
    try {
      const html = await fetchHtml(article.url);
      for (const candidate of [meta(html, "og:description"), meta(html, "description"), firstParagraph(html)]) {
        if (useful(candidate, article.title)) { preview = clean(candidate); break; }
      }
    } catch {}
  }

  article.previewText = preview ? preview.slice(0, 420) : "기사의 주요 내용은 원문에서 확인할 수 있습니다.";
  updated += 1;
}

payload.domesticPreviewNormalization = { updated, generatedAt: new Date().toISOString() };
await fs.writeFile(FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[domestic-preview] updated=${updated}`);
