#!/usr/bin/env node
/**
 * Iraq Weekly Report News Collector
 * - Google News RSS + configured Iraq media sources
 * - OpenAI Korean summary and report-category classification
 * - Designed for weekly situation report candidate selection
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { collectionPrompt, EDITORIAL_VERSION } from "./editorial-rules.mjs";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SOURCES_FILE = path.join(DATA_DIR, "iraq-media-sources.json");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const INDEX_FILE = path.join(DATA_DIR, "news-index.json");
const SEARCH_KEYWORDS_FILE = path.join(DATA_DIR, "search-keywords.json");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_SUMMARY_FALLBACK_MODEL = process.env.OPENAI_SUMMARY_FALLBACK_MODEL || "gpt-4o-mini";
let activeSummaryModel = OPENAI_SUMMARY_MODEL;
let summaryFallbackLogged = false;
const REUSABLE_EDITORIAL_VERSIONS = new Set([EDITORIAL_VERSION]);
const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 12);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 260);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const GOOGLE_QUERY_CONCURRENCY = Number(process.env.GOOGLE_QUERY_CONCURRENCY || 6);
const SOURCE_CONCURRENCY = Number(process.env.SOURCE_CONCURRENCY || 3);
const ARTICLE_FETCH_CONCURRENCY = Number(process.env.ARTICLE_FETCH_CONCURRENCY || 4);
// Full-text article prompts are large enough that five concurrent calls can
// exceed the fallback model's TPM allowance.  Keep the calls deliberately
// paced; this is independent of the article-fetch concurrency above.
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY || 2);
const AI_MIN_REQUEST_INTERVAL_MS = Number(process.env.AI_MIN_REQUEST_INTERVAL_MS || 2500);
const OPENAI_MAX_RETRIES = Number(process.env.OPENAI_MAX_RETRIES || 5);
const OPENAI_RETRY_BASE_MS = Number(process.env.OPENAI_RETRY_BASE_MS || 3000);
const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 10000);
const FULLTEXT_HYDRATION_CONCURRENCY = Number(process.env.FULLTEXT_HYDRATION_CONCURRENCY || 4);
const MIN_FULLTEXT_CHARS_FOR_AI = Number(process.env.MIN_FULLTEXT_CHARS_FOR_AI || 500);
const MIN_RSS_DESCRIPTION_CHARS_FOR_AI = Number(process.env.MIN_RSS_DESCRIPTION_CHARS_FOR_AI || 300);
const MIN_GOOGLE_RSS_EVIDENCE_CHARS = Number(process.env.MIN_GOOGLE_RSS_EVIDENCE_CHARS || 40);
const HIGH_PRIORITY_RSS_FALLBACK_SCORE = Number(process.env.HIGH_PRIORITY_RSS_FALLBACK_SCORE || 90);
const GOOGLE_RSS_FALLBACK_SCORE = Number(process.env.GOOGLE_RSS_FALLBACK_SCORE || 70);
const MAX_NEW_AI_ITEMS = Number(process.env.MAX_NEW_AI_ITEMS || 120);

let nextAiRequestAt = 0;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function waitForAiRequestSlot() {
  // Reserve the slot before waiting so concurrently running workers cannot
  // start their API calls at the same time.
  const now = Date.now();
  const scheduledAt = Math.max(now, nextAiRequestAt);
  nextAiRequestAt = scheduledAt + AI_MIN_REQUEST_INTERVAL_MS;
  if (scheduledAt > now) await sleep(scheduledAt - now);
}

function retryDelayMs(response, attempt) {
  const retryAfter = Number(response?.headers?.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.ceil(retryAfter * 1000);
  // A small jitter prevents retried workers from converging on one request slot.
  return Math.round(OPENAI_RETRY_BASE_MS * (2 ** attempt) + Math.random() * 750);
}

function isRetryableOpenAiStatus(status) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function loadGoogleNewsQueries() {
  const config = JSON.parse(await fs.readFile(SEARCH_KEYWORDS_FILE, "utf8"));
  const queries = Object.entries(config)
    .filter(([key]) => !key.startsWith("_"))
    .flatMap(([group, values]) => (Array.isArray(values) ? values : []).map((value) => ({
      query: String(value || "").trim(),
      group,
      ...queryPolicy(group)
    })))
    .filter((item) => item.query);

  if (!queries.length) throw new Error("No Google News queries configured in data/search-keywords.json");
  if (new Set(queries.map((item) => item.query)).size !== queries.length) throw new Error("Duplicate Google News queries found in data/search-keywords.json");
  return queries;
}

export function queryPolicy(group = "") {
  if (group === "korean_oil_market") {
    return { collectionLane: "oil_market", forcedCategory3: "oil_economy", locale: { hl: "ko", gl: "KR", ceid: "KR:ko" } };
  }
  if (group === "korean_middle_east") {
    return { collectionLane: "regional_context", forcedCategory3: "regional", locale: { hl: "ko", gl: "KR", ceid: "KR:ko" } };
  }
  if (group === "english_middle_east_fallback") {
    return { collectionLane: "regional_context", forcedCategory3: "regional", locale: { hl: "en-US", gl: "US", ceid: "US:en" } };
  }
  if (group === "arabic_iraq_politics") {
    return { collectionLane: "arabic_iraq_politics", forcedCategory3: "politics", locale: { hl: "ar", gl: "IQ", ceid: "IQ:ar" } };
  }
  if (group === "arabic_iraq_security_protests") {
    return { collectionLane: "arabic_iraq_security", forcedCategory3: "terror_security", locale: { hl: "ar", gl: "IQ", ceid: "IQ:ar" } };
  }
  if (group === "english_iraq_politics_security") {
    return { collectionLane: "iraq_politics_security", forcedCategory3: "", locale: { hl: "en-US", gl: "US", ceid: "US:en" } };
  }
  return { collectionLane: "core_bncp", forcedCategory3: "politics", locale: { hl: "ko", gl: "KR", ceid: "KR:ko" } };
}

const GOOGLE_NEWS_QUERIES = await loadGoogleNewsQueries();

function nowIso() { return new Date().toISOString(); }
function cutoffDate() { const d = new Date(); d.setUTCDate(d.getUTCDate() - DAYS); return d; }
function hasArabic(value = "") { return /[\u0600-\u06FF]/.test(String(value || "")); }
function stripArabicDiacritics(value = "") { return String(value || "").replace(/[\u064B-\u065F\u0670]/g, "").replace(/\u0640/g, ""); }
function decodeHtml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/\s+/g, " ").trim();
}
function stripTags(value = "") { return decodeHtml(String(value || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")); }
function normalizeText(value = "") { return decodeHtml(String(value || "")).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); }
function normalizeUrl(url = "") { try { const u = new URL(url); for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) u.searchParams.delete(key); u.hash = ""; return u.toString(); } catch { return url || ""; } }
function hostnameOf(url = "") { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }
function canonicalKey(item = {}) { return normalizeUrl(item.url || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || String(item.title || item.titleKo || "").toLowerCase().replace(/\s+/g, " ").trim(); }
function stableArticleId(prefix = "article", value = "") { return `${prefix}-${createHash("sha256").update(String(value || "")).digest("base64url").slice(0, 24)}`; }
function articleText(item = {}) { return [item.title, item.description, item.cleanText, item.fullText, item.titleKo, item.summaryKo].filter(Boolean).join("\n"); }
function hasAny(text = "", terms = []) { const normalized = stripArabicDiacritics(String(text || "").toLowerCase()); return terms.some((term) => normalized.includes(stripArabicDiacritics(String(term || "").toLowerCase()))); }

// Agriculture and food-production stories are outside the BNCP/Iraq weekly
// report scope unless the article also contains a direct housing, investment,
// security, energy, or political connection.  This must run before the broad
// economy keywords because agricultural articles often mention imports,
// costs, or the national economy as secondary effects.
function isOutOfScopeAgricultureArticle(text = "", directSignals = {}) {
  const agriculture = hasAny(text, [
    "وزارة الزراعة", "الزراعة", "زراعي", "زراعية", "المحاصيل", "المحصول",
    "البطاطا", "البطاطس", "بذور", "القمح", "الحبوب", "الأسمدة", "الري",
    "الثروة الحيوانية", "الأمن الغذائي", "food security", "agriculture",
    "agricultural", "farmers", "crop", "crops", "potato", "potatoes",
    "seed", "seeds", "wheat", "grain", "fertilizer", "irrigation",
    "livestock", "농업부", "농업", "농산물", "감자", "종자", "식량안보",
    "식량 안보", "농작물", "비료", "관개", "축산"
  ]);
  if (!agriculture) return false;

  const relevantNonAgriculture = hasAny(text, [
    "بسماية", "بسمايه", "بسمایه", "مشروع سكني", "مدينة سكنية", "الهيئة الوطنية للاستثمار",
    "شركة هانوا", "هانوا", "hanwha", "bismayah", "bncp", "housing", "residential",
    "construction", "urban planning", "المدن السكنية", "الإعمار والإسكان",
    "النفط", "أوبك", "oil", "opec", "الموازنة", "budget", "سعر الصرف", "exchange rate",
    "الكهرباء", "electricity", "مجلس الوزراء", "رئيس الوزراء", "مجلس النواب", "البرلمان",
    "الحكومة", "انتخابات", "فساد", "داعش", "إرهاب", "هجوم", "أمن الدولة", "national security", "isis",
    "terror", "attack", "إيران", "إسرائيل", "سوريا", "غزة", "iran", "israel", "syria", "gaza"
  ]);
  return !directSignals.bismayahDirect && !directSignals.bismayahStakeholder && !directSignals.bismayahInstitutional && !relevantNonAgriculture;
}

function regionalExposureSignals(text = "") {
  const iran = hasAny(text, ["إيران", "ايران", "الحرس الثوري", "iran", "irgc", "이란", "혁명수비대"]);
  const israel = hasAny(text, ["إسرائيل", "اسرائيل", "israel", "이스라엘"]);
  const unitedStates = hasAny(text, ["الولايات المتحدة", "أمريكا", "القواعد الأمريكية", "واشنطن", "united states", "american", "us bases", "washington", "미국", "미군기지"]);
  const conflictEscalation = hasAny(text, ["حرب", "ضربة", "ضربات", "هجوم", "قصف", "صاروخ", "صواريخ", "طائرة مسيرة", "تصعيد", "رد", "تهديد", "عقوبات", "war", "strike", "attack", "bombing", "missile", "drone", "escalation", "retaliation", "threat", "sanctions", "전쟁", "공습", "공격", "폭격", "미사일", "드론", "확전", "보복", "위협", "제재"]);
  const energyOrLogistics = hasAny(text, ["مضيق هرمز", "البحر الأحمر", "باب المندب", "النفط", "أسعار النفط", "ناقلات النفط", "الملاحة", "الشحن", "سلسلة التوريد", "إمدادات الطاقة", "hormuz", "red sea", "bab al-mandab", "oil price", "oil export", "oil tanker", "shipping", "navigation", "supply chain", "energy supply", "호르무즈", "홍해", "바브엘만데브", "유가", "원유 수출", "유조선", "해운", "항행", "공급망", "에너지 공급"]);
  const syria = hasAny(text, ["سوريا", "syri", "시리아"]);
  const syriaSpillover = syria && hasAny(text, ["الحدود", "داعش", "قسد", "الجيش الوطني السوري", "مخيمات", "هجوم", "اشتباك", "border", "isis", "sdf", "sna", "camp", "attack", "clash", "국경", "ISIS", "SDF", "SNA", "수용소", "공격", "교전"]);
  const regionalActor = iran || israel || unitedStates || syria || hasAny(text, ["الحوثي", "houthi", "후티"]);
  const strategic = (iran && (israel || unitedStates) && conflictEscalation) || energyOrLogistics || syriaSpillover;
  return { regionalActor, strategic };
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "user-agent": "Mozilla/5.0 Iraq Weekly Report Builder", "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return await res.text();
  } catch (err) {
    if (err && err.name === "AbortError") throw new Error(`Timeout after ${options.timeoutMs || FETCH_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function extractTag(xml = "", tag = "") { const match = String(xml || "").match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return match ? decodeHtml(match[1]) : ""; }
function googleNewsRssUrl(spec = {}) {
  const locale = spec.locale || { hl: "ar", gl: "IQ", ceid: "IQ:ar" };
  const params = new URLSearchParams({ q: `${spec.query || ""} when:${DAYS}d`, ...locale });
  return `https://news.google.com/rss/search?${params.toString()}`;
}
function parseRssItems(xml = "", spec = {}) {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const rawTitle = extractTag(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeHtml(sourceMatch[1]) : (String(rawTitle).split(" - ").pop() || "Google News");
    const pubDate = extractTag(block, "pubDate");
    return {
      id: stableArticleId("rss", normalizeUrl(extractTag(block, "link")) || rawTitle),
      title: rawTitle,
      titleKo: "",
      summaryKo: "",
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
      url: normalizeUrl(extractTag(block, "link")),
      query: spec.query || "",
      queryGroup: spec.group || "",
      collectionLane: spec.collectionLane || "",
      forcedCategory3: spec.forcedCategory3 || "",
      description: stripTags(extractTag(block, "description")),
      collectionMethod: "google-news-rss",
      sourceType: "google-news-rss"
    };
  }).filter((item) => item.title && item.url);
}

function hasArabicPoliticsSignal(text = "") {
  return hasAny(text, [
    "مجلس الوزراء", "رئيس الوزراء", "علي الزيدي", "الزيدي", "السوداني",
    "مجلس النواب", "البرلمان", "انتخابات", "الحكومة", "الإطار التنسيقي",
    "المالكي", "الصدر", "السيستاني", "الحشد الشعبي", "الحقائب الوزارية",
    "الكابينة الوزارية", "منح الثقة", "النزاهة", "مكافحة الفساد",
    "رئيس الهيئة الوطنية للاستثمار", "إعفاء", "إقالة"
  ]);
}

function hasArabicSecurityOrProtestSignal(text = "") {
  return hasAny(text, [
    "داعش", "إرهاب", "ارهاب", "هجوم إرهابي", "هجوم مسلح", "اشتباك",
    "عبوة ناسفة", "تفجير", "انتحاري", "اغتيال", "إطلاق نار", "قصف",
    "صاروخ", "طائرة مسيرة", "خطف", "الوضع الأمني", "تظاهرات", "احتجاجات",
    "اعتصام", "متظاهرين", "إغلاق الطرق", "المنطقة الخضراء"
  ]);
}

function hasOilMarketSignal(text = "") {
  return hasAny(text, [
    "국제유가", "두바이유", "브렌트유", "서부텍사스유", "WTI", "원유 가격",
    "유가 상승", "유가 하락", "원유 공급", "OPEC", "oil price", "crude oil",
    "brent", "west texas intermediate", "dubai crude"
  ]);
}

export function scoreCandidate(item = {}) {
  const text = articleText(item);
  const titleAndUrl = `${item.title || ""}\n${item.url || ""}`;
  const titleText = [item.title, item.titleKo, item.description].filter(Boolean).join("\n");
  const regionalSignals = regionalExposureSignals(titleText);
  const excluded = [];
  if (/ladbrokes|betting|odds|fixture|score|football|soccer|match|cup|world cup|youtube|tiktok|مباراة|منتخب|كرة|الدوري/i.test(text)) excluded.push("스포츠/베팅/영상성");
  if (/facebook\.com|instagram\.com|x\.com|twitter\.com/i.test(`${item.source || ""}\n${item.url || ""}`)) excluded.push("SNS 출처");
  if (/alsumaria\.tv\/watch\/|\b(?:MIC|Live Talk)\b|الممثلة|الممثل|الفنان|أبراج|ترفيه|منوعات|استديو|الحلقة\s*[٠-٩0-9]+/i.test(titleAndUrl)) excluded.push("연예/방송 프로그램");
  if (excluded.length) return { score: -999, category3: "exclude", reportUsefulness: "exclude", reason: excluded.join(", ") };

  if (item.collectionLane === "oil_market") {
    if (!hasOilMarketSignal(text)) return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "국제유가 직접 관련성 부족" };
    return { score: 84, category3: "oil_economy", reportUsefulness: "include", reason: "한국어 국제유가 변동 원인 후보" };
  }
  if (item.collectionLane === "regional_context") {
    if (!regionalSignals.regionalActor && !regionalSignals.strategic) {
      return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "중동 주요 정세 직접 관련성 부족" };
    }
    return { score: 82, category3: "regional", reportUsefulness: "include", reason: "한국어·영문 중동 주요 정세 후보" };
  }

  const arabicSource = hasArabic(item.title || "") ||
    String(item.collectionLane || "").startsWith("arabic_") ||
    item.sourceType === "iraq-media-direct";
  if (arabicSource) {
    const security = hasArabicSecurityOrProtestSignal(text);
    const politics = hasArabicPoliticsSignal(text);
    if (security) return { score: 80, category3: "terror_security", reportUsefulness: "include", reason: "이라크 테러·치안·시위 후보" };
    if (politics) return { score: 76, category3: "politics", reportUsefulness: "include", reason: "이라크 정치권 동향 후보" };
    return { score: -40, category3: "exclude", reportUsefulness: "exclude", reason: "아랍어 수집 범위(이라크 정치·테러·시위) 밖 기사" };
  }

  const iraqContext = hasAny(text, ["iraq", "iraqi", "baghdad", "basra", "kirkuk", "erbil", "ali al-zaidi", "al-zaidi", "이라크", "바그다드"]);
  const bismayahDirect = hasAny(text, ["bismayah", "bismaya", "bncp", "비스마야"]);
  const bismayahStakeholder = hasAny(text, ["hanwha", "한화"]);
  const directSignals = { bismayahDirect, bismayahStakeholder, bismayahInstitutional: false };
  if (isOutOfScopeAgricultureArticle(text, directSignals)) {
    return { score: -50, category3: "exclude", reportUsefulness: "exclude", reason: "정치·치안·국제유가·중동 정세와 직접 연결되지 않은 농업/식량 기사" };
  }

  if (bismayahDirect || (bismayahStakeholder && iraqContext)) {
    return { score: 100, category3: "politics", reportUsefulness: "include", reason: "비스마야·한화 직접 관련 최우선 기사" };
  }

  let score = 35;
  let category3 = "politics";
  let reason = "이라크 주간 정세 참고자료";

  if (iraqContext && hasAny(text, ["cabinet", "prime minister", "al-zaidi", "parliament", "election", "government", "corruption", "coordination framework", "pmf", "sadr", "maliki", "정치", "의회", "정부", "선거", "총리", "부패"])) {
    score = Math.max(score, 76);
    category3 = "politics";
    reason = "이라크 정치권 동향 후보";
  }
  if (iraqContext && hasAny(text, ["security", "isis", "terror", "attack", "rocket", "drone", "kidnap", "protest", "shooting", "ied", "치안", "테러", "공격", "드론", "납치", "시위", "총격"])) {
    score = Math.max(score, 80);
    category3 = "terror_security";
    reason = "이라크 테러·치안·시위 후보";
  }
  if (regionalSignals.strategic) {
    score = Math.max(score, 78);
    category3 = "regional";
    reason = "중동 안보·물류에 영향을 주는 주요 국제정세 후보";
  }

  return { score, category3, reportUsefulness: score >= 70 ? "include" : "exclude", reason };
}

function looksLikeArticleUrl(url = "") {
  try {
    const u = new URL(url);
    const p = decodeURIComponent(u.pathname || "").toLowerCase();
    const q = decodeURIComponent(u.search || "").toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp|svg|ico|css|js|pdf|zip|rar|mp4|mp3|woff2?)$/i.test(p)) return false;
    if (/\/(tag|tags|category|categories|section|sections|author|authors|search|login|privacy|about|contact)(\/|$)/i.test(p)) return false;
    if (/\/page\/\d+\/?$/i.test(p) || /(^|[?&])page=\d+/i.test(q)) return false;
    if (/(^|[?&])(id|key|newsid|articleid)=\d+/i.test(q)) return true;
    if (/\/(article|articles|news|story|stories|details|detail|reports?|iraq|politics|economy|security)\//i.test(p) && /\d{3,}/.test(`${p}${q}`)) return true;
    if (/\d{4,}/.test(p)) return true;
    if (/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\//.test(p)) return true;
    return false;
  } catch { return false; }
}

function toAbsoluteUrl(href, baseUrl) { try { return normalizeUrl(new URL(decodeHtml(href), baseUrl).toString()); } catch { return ""; } }
function sameHost(url, baseUrl) { const a = hostnameOf(url); const b = hostnameOf(baseUrl); return a && b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)); }
function extractUrlsFromHtml(html = "", baseUrl = "") { const urls = []; const re = /href\s*=\s*["']([^"'#]+)["']/gi; let m; while ((m = re.exec(html))) { if (/^(mailto:|tel:|javascript:)/i.test(m[1])) continue; const url = toAbsoluteUrl(m[1], baseUrl); if (url) urls.push(url); } return [...new Set(urls)]; }
function extractMetaContent(html = "", names = []) { for (const name of names) { const patterns = [new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"), new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"), new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, "i")]; for (const p of patterns) { const m = html.match(p); if (m && m[1]) return decodeHtml(m[1]); } } return ""; }
function extractReadableText(html = "") { let src = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<nav[\s\S]*?<\/nav>/gi, " ").replace(/<footer[\s\S]*?<\/footer>/gi, " ").replace(/<header[\s\S]*?<\/header>/gi, " "); const body = (src.match(/<article[^>]*>([\s\S]*?)<\/article>/i) || src.match(/<main[^>]*>([\s\S]*?)<\/main>/i) || src.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [null, src])[1]; const paragraphs = [...body.matchAll(/<(p|h1|h2|h3|li)[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => stripTags(m[2])).filter((x) => x.length >= 20).filter((x) => !/cookie|subscribe|newsletter|advertisement|privacy|حقوق النشر|اشترك|إعلان/i.test(x)).slice(0, 90); return normalizeText((paragraphs.length >= 3 ? paragraphs.join("\n") : stripTags(body))).slice(0, MAX_ARTICLE_TEXT_CHARS); }
function extractPublishedAt(html = "", fallback = "") { const meta = extractMetaContent(html, ["article:published_time", "article:modified_time", "pubdate", "publishdate", "date", "datePublished", "dateModified"]); const jsonLd = (html.match(/"datePublished"\s*:\s*"([^"]+)"/i) || [])[1] || ""; const time = (html.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i) || [])[1] || ""; for (const v of [meta, jsonLd, time, fallback]) { const d = new Date(v); if (v && !Number.isNaN(d.getTime())) return d.toISOString(); } return ""; }
function parseArticleHtml(html = "", url = "", source = {}, fallbackDate = "") { const title = extractMetaContent(html, ["og:title", "twitter:title", "title"]) || stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "") || stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""); if (!title || title.length < 4) return null; const cleanText = extractReadableText(html); const desc = [extractMetaContent(html, ["og:description", "twitter:description", "description"]), cleanText.slice(0, 2500)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); return { id: stableArticleId("direct", normalizeUrl(url)), title, source: source.name || hostnameOf(url) || "Iraq media", publishedAt: extractPublishedAt(html, fallbackDate), url: normalizeUrl(url), description: desc, cleanText, fullText: cleanText, collectionLane: "arabic_iraq_direct", collectionMethod: "iraq-media-direct", sourceType: "iraq-media-direct" }; }

function sourceEvidenceText(item = {}) {
  return normalizeText(item.cleanText || item.fullText || item.description || "");
}

function hasUsableFullText(item = {}) {
  return normalizeText(item.cleanText || item.fullText || "").length >= MIN_FULLTEXT_CHARS_FOR_AI;
}

function evidenceLevelFor(item = {}) {
  if (hasUsableFullText(item)) return "fulltext";
  if (normalizeText(item.description || "").length >= MIN_RSS_DESCRIPTION_CHARS_FOR_AI) return "rss-description";
  if (item.sourceType === "google-news-rss" && normalizeText(`${item.title || ""} ${item.description || ""}`).length >= MIN_GOOGLE_RSS_EVIDENCE_CHARS) return "rss-description";
  return "insufficient";
}

async function hydrateSelectedArticle(item = {}) {
  if (hasUsableFullText(item)) {
    return {
      ...item,
      sourceEvidenceLevel: "fulltext",
      sourceEvidenceChars: sourceEvidenceText(item).length
    };
  }

  if (!item.url || !/^https?:/i.test(item.url)) {
    return {
      ...item,
      sourceEvidenceLevel: evidenceLevelFor(item),
      sourceEvidenceChars: sourceEvidenceText(item).length
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(item.url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 Iraq Weekly Report Evidence Hydrator",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const html = await res.text();
    const finalUrl = res.url || item.url;
    const finalHost = hostnameOf(finalUrl);

    if (finalHost && finalHost !== "news.google.com") {
      const parsed = parseArticleHtml(
        html,
        finalUrl,
        { name: item.source || finalHost || "Iraq media" },
        item.publishedAt || ""
      );

      if (parsed && hasUsableFullText(parsed)) {
        return {
          ...item,
          title: parsed.title || item.title,
          source: item.source || parsed.source,
          publishedAt: item.publishedAt || parsed.publishedAt,
          url: parsed.url || finalUrl,
          description: parsed.description || item.description,
          cleanText: parsed.cleanText,
          fullText: parsed.fullText,
          sourceEvidenceLevel: "fulltext",
          sourceEvidenceChars: sourceEvidenceText(parsed).length
        };
      }
    }
  } catch (err) {
    console.warn(`[fulltext] ${String(item.title || "").slice(0, 90)} - ${err.message || err}`);
  } finally {
    clearTimeout(timer);
  }

  return {
    ...item,
    sourceEvidenceLevel: evidenceLevelFor(item),
    sourceEvidenceChars: sourceEvidenceText(item).length
  };
}

function canSummarizeFromEvidence(item = {}) {
  if (item.sourceEvidenceLevel === "fulltext") return true;
  if (item.sourceType === "google-news-rss" && item.sourceEvidenceLevel === "rss-description") {
    return Number(item.importanceScore || 0) >= GOOGLE_RSS_FALLBACK_SCORE;
  }
  return item.sourceEvidenceLevel === "rss-description" &&
    Number(item.importanceScore || 0) >= HIGH_PRIORITY_RSS_FALLBACK_SCORE;
}

function koreanOutputText(parsed = {}) {
  return [
    parsed.titleKo,
    parsed.summaryKo,
    parsed.reportBullet,
    ...(Array.isArray(parsed.reportSubBullets) ? parsed.reportSubBullets : [])
  ].filter(Boolean).join("\n");
}

function responseHasCountryShift(item = {}, parsed = {}) {
  const source = sourceEvidenceText(item);
  const output = koreanOutputText(parsed).replace(/친이란/g, "");
  const sourceHasIraq = hasAny(source, ["العراق", "العراقي", "بغداد", "iraq", "iraqi", "baghdad", "이라크", "바그다드"]);
  const sourceHasIran = hasAny(source, ["إيران", "ايران", "طهران", "iran", "tehran", "teheran", "이란", "테헤란"]);
  const outputHasIraqAsPlace = /이라크(?:\s*(?:내|에서|에|로|정부|의회|총리|대통령|투자|사업|재건|귀환|방문))|Baghdad|바그다드/i.test(output);
  const outputHasIranAsPlace = /이란(?:\s*(?:내|에서|에|으로|정부|의회|총리|대통령|투자|사업|재건|귀환|방문))|Teh?eran|테헤란/i.test(output);

  return (sourceHasIraq && !sourceHasIran && outputHasIranAsPlace) ||
    (sourceHasIran && !sourceHasIraq && outputHasIraqAsPlace);
}

async function collectGoogleNews() {
  const results = await mapLimit(GOOGLE_NEWS_QUERIES, GOOGLE_QUERY_CONCURRENCY, async (spec) => {
    try {
      const xml = await fetchText(googleNewsRssUrl(spec));
      const items = parseRssItems(xml, spec).slice(0, MAX_PER_QUERY).map(applyInitialScore).filter((x) => x.reportUsefulness !== "exclude");
      console.log(`[google:${spec.group}] ${spec.query}: ${items.length}`);
      return { items, debug: { query: spec.query, group: spec.group, lane: spec.collectionLane, ok: true, count: items.length } };
    } catch (err) {
      console.warn(`[google:${spec.group}] ${spec.query}: ${err.message || err}`);
      return { items: [], debug: { query: spec.query, group: spec.group, lane: spec.collectionLane, ok: false, error: String(err.message || err) } };
    }
  });
  return { articles: results.flatMap((x) => x.items), debug: results.map((x) => x.debug) };
}

async function collectSource(source) {
  const candidates = [];
  const debug = { id: source.id, name: source.name, ok: true, probes: [] };
  const probeUrls = [...(source.rssUrls || []), ...(source.sitemapUrls || []), ...(source.listPages || []), source.baseUrl].filter(Boolean);
  for (const probe of [...new Set(probeUrls)]) {
    try {
      const text = await fetchText(probe);
      if (/<rss|<feed|<item/i.test(text)) {
        const rssItems = parseRssItems(text, {
          query: `source:${source.id}`,
          group: "arabic_iraq_direct",
          collectionLane: "arabic_iraq_direct",
          forcedCategory3: "",
          locale: { hl: "ar", gl: "IQ", ceid: "IQ:ar" }
        }).slice(0, MAX_PER_QUERY);
        candidates.push(...rssItems.map((item) => ({ url: item.url, rssItem: item })));
        debug.probes.push({ url: probe, type: "rss", count: rssItems.length, ok: true });
      } else {
        const urls = extractUrlsFromHtml(text, probe).filter((url) => sameHost(url, source.baseUrl)).filter(looksLikeArticleUrl).slice(0, 35);
        candidates.push(...urls.map((url) => ({ url })));
        debug.probes.push({ url: probe, type: "html", count: urls.length, ok: true });
      }
    } catch (err) {
      debug.probes.push({ url: probe, ok: false, error: String(err.message || err).slice(0, 160) });
    }
  }
  const seen = new Set();
  const unique = candidates.filter((c) => { const k = normalizeUrl(c.url); if (!k || seen.has(k)) return false; seen.add(k); return true; }).slice(0, 45);
  const articles = await mapLimit(unique, ARTICLE_FETCH_CONCURRENCY, async (candidate) => {
    if (candidate.rssItem) {
      try {
        const html = await fetchText(candidate.url);
        return parseArticleHtml(html, candidate.url, source, candidate.rssItem.publishedAt) || candidate.rssItem;
      } catch { return candidate.rssItem; }
    }
    try {
      const html = await fetchText(candidate.url);
      return parseArticleHtml(html, candidate.url, source);
    } catch { return null; }
  });
  const filtered = articles.filter(Boolean).map(applyInitialScore).filter((x) => x.reportUsefulness !== "exclude");
  console.log(`[source] ${source.name}: ${filtered.length}/${articles.filter(Boolean).length}`);
  return { articles: filtered, debug };
}

async function collectIraqMediaSources() {
  let sources = [];
  try { sources = JSON.parse(await fs.readFile(SOURCES_FILE, "utf8")); } catch {}
  sources = sources.filter((s) => s && s.enabled !== false && s.baseUrl);
  const results = await mapLimit(sources, SOURCE_CONCURRENCY, collectSource);
  return { articles: results.flatMap((x) => x.articles), debug: results.map((x) => x.debug) };
}

function applyInitialScore(item) {
  const scored = scoreCandidate(item);
  return {
    ...item,
    category1: scored.category3 === "regional" ? "international" : "domestic",
    category2: scored.category3 === "oil_economy" ? "economy" : scored.category3 === "regional" ? "international" : "politics_security",
    category3: scored.category3,
    importanceScore: scored.score,
    reportUsefulness: scored.reportUsefulness,
    weeklyReportReason: scored.reason
  };
}

function isExcludedNinaArticle(item = {}) {
  const source = String(item.source || item.publisher || "").trim();
  const url = String(item.url || item.link || item.resolvedUrl || "");
  return /^(NINA|وكالة الانباء العراقية \(نينا\)|وكالة الأنباء العراقية \(نينا\))$/i.test(source) ||
    /ninanews\.com/i.test(url);
}

function weeklyReportTitleText(item = {}) {
  return [item.title, item.titleKo].filter(Boolean).join("\n");
}

function hasWeeklyReportScope(item = {}) {
  const title = weeklyReportTitleText(item);
  if (item.collectionLane) return true;

  const directIraqOrProject = hasAny(title, [
    "العراق", "عراقي", "بغداد", "البصرة", "كركوك", "أربيل", "النجف", "كربلاء", "الأنبار", "نينوى", "ديالى", "ميسان",
    "مجلس الوزراء", "رئيس الوزراء", "مجلس النواب", "البرلمان العراقي", "الإطار التنسيقي", "الحشد الشعبي",
    "الهيئة الوطنية للاستثمار", "هيئة الاستثمار", "بسماية", "بسمايه", "هانوا", "حيدر مكية", "عادل الياسري",
    "iraq", "iraqi", "baghdad", "basra", "kirkuk", "erbil", "najaf", "karbala", "pmf", "coordination framework",
    "national investment commission", "bismayah", "bismaya", "bncp", "hanwha",
    "이라크", "바그다드", "비스마야", "한화", "국가투자위원회", "시아조정기구", "인민동원군"
  ]);

  const strategicMiddleEast = regionalExposureSignals(title).strategic;

  if (directIraqOrProject || strategicMiddleEast) return true;

  const foreignLocalPlace = hasAny(title, [
    "بريطانيا", "المملكة المتحدة", "إنجلترا", "لندن", "سوفولك", "مانشستر", "فرنسا", "باريس", "ألمانيا", "برلين",
    "إيطاليا", "إسبانيا", "السويد", "النرويج", "هولندا", "بلجيكا", "الولايات المتحدة", "نيويورك", "كندا", "أستراليا",
    "uk", "united kingdom", "britain", "england", "london", "suffolk", "manchester", "france", "paris", "germany", "berlin",
    "italy", "spain", "sweden", "norway", "netherlands", "belgium", "united states", "new york", "canada", "australia",
    "영국", "런던", "서퍽", "맨체스터", "프랑스", "파리", "독일", "베를린", "이탈리아", "스페인", "스웨덴", "노르웨이", "네덜란드", "벨기에", "미국", "뉴욕", "캐나다", "호주"
  ]);

  const localCrimeOrTerror = hasAny(title, [
    "إرهاب", "تهديد", "اعتقال", "إلقاء القبض", "هجوم", "طعن", "إطلاق نار", "تفجير", "فعالية إسلامية", "مسجد",
    "terror", "threat", "arrest", "detained", "attack", "stabbing", "shooting", "bomb", "islamic event", "mosque",
    "테러", "위협", "체포", "구금", "공격", "흉기", "총격", "폭발", "이슬람 행사", "모스크"
  ]);

  if (foreignLocalPlace && localCrimeOrTerror) return false;
  return false;
}

function uniqueRecent(items, limit = MAX_TOTAL) {
  const cutoff = cutoffDate();
  const map = new Map();
  for (const item of items) {
    if (isExcludedNinaArticle(item)) continue;
    if (!hasWeeklyReportScope(item)) continue;
    if (item.publishedAt) { const d = new Date(item.publishedAt); if (!Number.isNaN(d.getTime()) && d < cutoff) continue; }
    const key = canonicalKey(item);
    if (!key) continue;
    const old = map.get(key);
    if (!old || Number(item.importanceScore || 0) > Number(old.importanceScore || 0)) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, limit);
}

function hasReusableAiSummary(item = {}) {
  const evidenceBacked = item.sourceEvidenceLevel === "fulltext" ||
    item.sourceEvidenceLevel === "rss-description" ||
    hasUsableFullText(item);
  return !!(
    item.titleKo && item.summaryKo &&
    REUSABLE_EDITORIAL_VERSIONS.has(item.aiSummaryVersion) &&
    evidenceBacked &&
    !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) &&
    !item.translationFailed &&
    !responseHasCountryShift(item, item)
  );
}
function reuseFromPrevious(item, previousMap) { const cached = previousMap.get(canonicalKey(item)); return cached && hasReusableAiSummary(cached) ? { ...item, ...cached, url: item.url || cached.url, source: item.source || cached.source, aiCacheHit: true } : { ...item, aiCacheHit: false }; }
async function loadPreviousMap() { const map = new Map(); try { const prev = JSON.parse(await fs.readFile(NEWS_FILE, "utf8")); for (const item of prev.articles || []) if (hasReusableAiSummary(item)) map.set(canonicalKey(item), item); } catch {} return map; }

function isUsableArchivedArticle(item = {}) {
  const published = new Date(item.publishedAt || item.date || "");
  return !!(
    canonicalKey(item) &&
    !Number.isNaN(published.getTime()) &&
    published >= cutoffDate() &&
    item.titleKo && item.summaryKo &&
    !item.translationFailed &&
    !item.untranslatedFiltered &&
    item.reportUsefulness !== "exclude" &&
    item.category3 !== "exclude" &&
    hasWeeklyReportScope(item) &&
    scoreCandidate(item).reportUsefulness !== "exclude"
  );
}

async function loadPreviousArticles() {
  try {
    const previous = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
    return (previous.articles || []).filter(isUsableArchivedArticle);
  } catch {
    return [];
  }
}

function mergePreviousArticles(current = [], previous = [], limit = MAX_TOTAL) {
  const previousByKey = new Map(previous.map((item) => [canonicalKey(item), item]));
  const merged = new Map(previousByKey);

  for (const item of current) {
    const key = canonicalKey(item);
    if (!key) continue;
    const archived = merged.get(key);
    if (archived && isUsableArchivedArticle(archived) && !isUsableArchivedArticle(item)) continue;
    merged.set(key, item);
  }

  const articles = [...merged.values()]
    .filter((item) => isUsableArchivedArticle(item) || current.includes(item))
    .sort((a, b) => new Date(b.publishedAt || b.date || 0) - new Date(a.publishedAt || a.date || 0) || Number(b.importanceScore || 0) - Number(a.importanceScore || 0))
    .slice(0, limit);
  const carriedForward = articles.filter((item) => previousByKey.get(canonicalKey(item)) === item).length;
  return { articles, carriedForward };
}

async function aiKorean(prompt, input) {
  const request = async (model) => {
    await waitForAiRequestSlot();
    return fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [{ role: "system", content: "You classify Iraq news for a Korean weekly situation report. Output valid JSON only." }, { role: "user", content: `${prompt}\n\n기사 데이터:\n${input}` }] }) });
  };

  let model = activeSummaryModel;
  for (let attempt = 0; attempt < OPENAI_MAX_RETRIES; attempt += 1) {
    let res;
    try {
      res = await request(model);
    } catch (error) {
      if (attempt === OPENAI_MAX_RETRIES - 1) throw error;
      const delay = retryDelayMs(null, attempt);
      console.warn(`[ai] connection error; retrying attempt ${attempt + 2}/${OPENAI_MAX_RETRIES} in ${Math.ceil(delay / 1000)}s: ${error.message}`);
      await sleep(delay);
      continue;
    }

    if (res.ok) {
      const data = await res.json();
      return data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("\n");
    }

    const errorText = await res.text();
    const modelUnavailable = res.status === 404 && /model_not_found|must be verified|verified to use/i.test(errorText);
    if (modelUnavailable && OPENAI_SUMMARY_FALLBACK_MODEL && model !== OPENAI_SUMMARY_FALLBACK_MODEL) {
      activeSummaryModel = OPENAI_SUMMARY_FALLBACK_MODEL;
      model = activeSummaryModel;
      if (!summaryFallbackLogged) {
        console.warn(`[ai] ${OPENAI_SUMMARY_MODEL} unavailable; falling back to ${activeSummaryModel}`);
        summaryFallbackLogged = true;
      }
      continue;
    }

    if (!isRetryableOpenAiStatus(res.status) || attempt === OPENAI_MAX_RETRIES - 1) {
      throw new Error(`OpenAI ${res.status}: ${errorText}`);
    }
    const delay = retryDelayMs(res, attempt);
    console.warn(`[ai] OpenAI ${res.status}; retrying attempt ${attempt + 2}/${OPENAI_MAX_RETRIES} in ${Math.ceil(delay / 1000)}s`);
    await sleep(delay);
  }

  throw new Error("OpenAI request retry limit reached");
}
function parseJsonObject(text = "") { const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(); try { return JSON.parse(raw); } catch {} const m = raw.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return null; }
function clean(value = "") { return String(value || "").replace(/^[-*·•\s]+/, "").replace(/^☞\s*/, "").replace(/\s+/g, " ").trim(); }
function normalizeArray(value, limit = 3) { if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, limit); if (typeof value === "string") return value.split(/\n+|(?<=\.)\s+/).map(clean).filter(Boolean).slice(0, limit); return []; }
function clampScore(value, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback; }
function normalizeCategory3(v = "", fallback = "politics") { const x = String(v || "").trim(); return ["politics", "terror_security", "oil_economy", "regional", "exclude"].includes(x) ? x : fallback; }
function normalizeSecurityEventType(value = "", item = {}) {
  const allowed = new Set(["armed_attack", "ied", "assassination", "protest", "shooting", "suicide_bombing", "other", "none"]);
  const parsed = String(value || "").trim();
  if (allowed.has(parsed)) return parsed;
  if (item.category3 !== "terror_security") return "none";
  const text = articleText(item);
  if (hasAny(text, ["تظاهرات", "احتجاجات", "اعتصام", "متظاهرين", "protest", "demonstration", "시위", "집회"])) return "protest";
  if (hasAny(text, ["عبوة ناسفة", "ied", "급조폭발물"])) return "ied";
  if (hasAny(text, ["انتحاري", "suicide bombing", "자살폭탄"])) return "suicide_bombing";
  if (hasAny(text, ["اغتيال", "assassination", "암살"])) return "assassination";
  if (hasAny(text, ["إطلاق نار", "shooting", "총격"])) return "shooting";
  return "armed_attack";
}
function normalizeSecurityEventCount(value, type = "none") {
  if (type === "none") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 1;
}

async function enrichArticle(item) {
  if (!OPENAI_API_KEY) return item;
  const text = normalizeText(item.cleanText || item.fullText || item.description || "").slice(0, MAX_ARTICLE_TEXT_CHARS);
  const input = JSON.stringify({
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    url: item.url,
    description: item.description,
    text,
    sourceEvidenceLevel: item.sourceEvidenceLevel || evidenceLevelFor(item),
    sourceEvidenceChars: Number(item.sourceEvidenceChars || sourceEvidenceText(item).length),
    collectionLane: item.collectionLane || "",
    forcedCategory3: item.forcedCategory3 || "",
    initialCategory: item.category3,
    initialReason: item.weeklyReportReason
  }, null, 2);
  const prompt = collectionPrompt({
    collectionLane: item.collectionLane || "",
    forcedCategory3: item.forcedCategory3 || "",
    sourceLanguage: hasArabic(`${item.title || ""}\n${text}`) ? "Arabic" : /[가-힣]/.test(`${item.title || ""}\n${text}`) ? "Korean" : "English"
  });
  try {
    let parsed = parseJsonObject(await aiKorean(prompt, input));
    const invalid = () => !parsed || !parsed.titleKo || !parsed.summaryKo || hasArabic(parsed.titleKo) || hasArabic(parsed.summaryKo);

    if (invalid() || responseHasCountryShift(item, parsed)) {
      const retryPrompt = [
        prompt,
        "이전 응답을 원문과 다시 대조하라. 특히 이라크와 이란, 투자 대상국, 기관·인명·날짜·수치를 바꾸거나 섞지 말라.",
        "문자열을 기계적으로 치환하지 말고 원문 문맥을 다시 읽어 JSON 전체를 새로 작성하라."
      ].join("\n");
      parsed = parseJsonObject(await aiKorean(retryPrompt, input));
    }

    if (invalid() || responseHasCountryShift(item, parsed)) throw new Error("bad or source-inconsistent AI JSON");
    const categoryLocked = !!item.forcedCategory3 ||
      String(item.collectionLane || "").startsWith("arabic_") ||
      item.collectionLane === "oil_market" ||
      item.collectionLane === "regional_context" ||
      item.collectionLane === "core_bncp";
    const category3 = categoryLocked ? item.category3 : normalizeCategory3(parsed.category3, item.category3);
    const securityEventType = normalizeSecurityEventType(parsed.securityEventType, { ...item, category3 });
    return {
      ...item,
      titleKo: clean(parsed.titleKo),
      summaryKo: String(parsed.summaryKo || "").trim(),
      category1: parsed.category1 === "international" || category3 === "regional" ? "international" : "domestic",
      category2: ["politics_security", "economy", "international"].includes(parsed.category2) ? parsed.category2 : (category3 === "oil_economy" ? "economy" : category3 === "regional" ? "international" : "politics_security"),
      category3,
      importanceScore: Math.max(Number(item.importanceScore || 0), clampScore(parsed.importanceScore, item.importanceScore || 50)),
      reportUsefulness: ["include", "watch", "exclude"].includes(parsed.reportUsefulness) ? parsed.reportUsefulness : item.reportUsefulness,
      weeklyReportReason: clean(parsed.weeklyReportReason || item.weeklyReportReason),
      reportBullet: clean(parsed.reportBullet),
      reportSubBullets: normalizeArray(parsed.reportSubBullets, 5),
      reportImplication: clean(parsed.reportImplication),
      actors: normalizeArray(parsed.actors, 8),
      location: clean(parsed.location),
      securityEventType,
      securityEventCount: normalizeSecurityEventCount(parsed.securityEventCount, securityEventType),
      sourceReliability: clean(parsed.sourceReliability || "일반 언론"),
      selected: false,
      aiSummaryVersion: EDITORIAL_VERSION
    };
  } catch (err) {
    console.warn(`[ai] failed: ${item.title} - ${err.message || err}`);
    return { ...item, translationFailed: true };
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const startedAt = Date.now();
  const [google, direct] = await Promise.all([collectGoogleNews(), collectIraqMediaSources()]);
  let articles = uniqueRecent([...google.articles, ...direct.articles], MAX_TOTAL);
  const previousArticles = await loadPreviousArticles();
  const previousMap = await loadPreviousMap();
  articles = articles
    .map((item) => reuseFromPrevious(item, previousMap))
    .filter((item) => scoreCandidate(item).reportUsefulness !== "exclude");
  articles = articles.map((item) => {
    const baseline = scoreCandidate(item);
    if (baseline.reportUsefulness === "exclude" || baseline.category3 === "exclude") {
      return { ...item, importanceScore: Math.min(Number(item.importanceScore || 0), 0), category3: "exclude", reportUsefulness: "exclude", selected: false, weeklyReportReason: baseline.reason };
    }
    return { ...item, importanceScore: Math.max(Number(item.importanceScore || 0), Number(baseline.score || 0)) };
  });
  const cacheHits = articles.filter((x) => x.aiCacheHit).length;
  const toHydrate = articles.filter((x) => !x.aiCacheHit);
  const hydrated = await mapLimit(toHydrate, FULLTEXT_HYDRATION_CONCURRENCY, hydrateSelectedArticle);
  let hydratedIndex = 0;
  articles = articles.map((item) => item.aiCacheHit ? item : (hydrated[hydratedIndex++] || item));
  articles = articles.map((item) => {
    const baseline = scoreCandidate(item);
    if (baseline.reportUsefulness === "exclude" || baseline.category3 === "exclude") {
      return { ...item, importanceScore: Math.min(Number(item.importanceScore || 0), 0), category3: "exclude", reportUsefulness: "exclude", selected: false, weeklyReportReason: baseline.reason };
    }
    return item;
  });

  const eligible = articles
    .filter((item) => !item.aiCacheHit && item.reportUsefulness !== "exclude" && item.category3 !== "exclude" && canSummarizeFromEvidence(item))
    .sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, MAX_NEW_AI_ITEMS);

  const enriched = OPENAI_API_KEY ? await mapLimit(eligible, AI_CONCURRENCY, enrichArticle) : eligible;
  const enrichedMap = new Map(eligible.map((item, index) => [item, enriched[index]]));
  articles = articles.map((item) => {
    if (item.aiCacheHit) return item;
    const result = enrichedMap.get(item);
    if (result) return result;
    return {
      ...item,
      reportUsefulness: "exclude",
      category3: "exclude",
      translationFailed: true,
      evidenceInsufficient: true,
      weeklyReportReason: item.sourceEvidenceLevel === "insufficient"
        ? "기사 전문 또는 충분한 원문 설명 미확보"
        : "AI 처리 상한 초과"
    };
  }).filter((item) => item.reportUsefulness !== "exclude" && item.category3 !== "exclude");

  const archiveMerge = mergePreviousArticles(articles, previousArticles, MAX_TOTAL);
  articles = archiveMerge.articles;
  console.log(`[archive] previous=${previousArticles.length}, carriedForward=${archiveMerge.carriedForward}, merged=${articles.length}`);

  const evidenceStats = {
    fulltext: articles.filter((x) => x.sourceEvidenceLevel === "fulltext").length,
    rssDescription: articles.filter((x) => x.sourceEvidenceLevel === "rss-description").length,
    insufficient: articles.filter((x) => x.sourceEvidenceLevel === "insufficient").length,
    aiEligible: eligible.length
  };
  console.log(`[evidence-first] fulltext=${evidenceStats.fulltext}, rssDescription=${evidenceStats.rssDescription}, insufficient=${evidenceStats.insufficient}, aiEligible=${evidenceStats.aiEligible}`);

  const counts = {
    total: articles.length,
    politics: articles.filter((x) => x.category3 === "politics").length,
    terror_security: articles.filter((x) => x.category3 === "terror_security").length,
    oil_economy: articles.filter((x) => x.category3 === "oil_economy").length,
    regional: articles.filter((x) => x.category3 === "regional").length,
    exclude: articles.filter((x) => x.category3 === "exclude" || x.reportUsefulness === "exclude").length
  };

  const generatedAt = nowIso();
  const payload = { category: "iraq-weekly-report-news", generatedAt, lookbackDays: DAYS, count: articles.length, cacheHits, model: OPENAI_API_KEY ? activeSummaryModel : "none", requestedModel: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none", counts, articles, debug: { google: google.debug, direct: direct.debug, evidence: evidenceStats, archive: { previous: previousArticles.length, carriedForward: archiveMerge.carriedForward }, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) } };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(INDEX_FILE, JSON.stringify({ generatedAt, source: "collect-news.mjs", files: { news: "data/news.json" }, counts, archive: payload.debug.archive, elapsedSeconds: payload.debug.elapsedSeconds }, null, 2), "utf8");
  console.log(`Done. articles=${articles.length}, cacheHits=${cacheHits}, elapsed=${payload.debug.elapsedSeconds}s`);
}

async function mapLimit(arr, limit, fn) {
  const ret = [];
  let idx = 0;
  async function worker() { while (idx < arr.length) { const cur = idx++; ret[cur] = await fn(arr[cur], cur); } }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return ret;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
