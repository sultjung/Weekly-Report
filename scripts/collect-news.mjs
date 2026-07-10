#!/usr/bin/env node
/**
 * Iraq Weekly Report News Collector
 * - Google News RSS + configured Iraq media sources
 * - OpenAI Korean summary and report-category classification
 * - Designed for weekly situation report candidate selection
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const SOURCES_FILE = path.join(DATA_DIR, "iraq-media-sources.json");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const INDEX_FILE = path.join(DATA_DIR, "news-index.json");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";
const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 12);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 260);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const GOOGLE_QUERY_CONCURRENCY = Number(process.env.GOOGLE_QUERY_CONCURRENCY || 6);
const SOURCE_CONCURRENCY = Number(process.env.SOURCE_CONCURRENCY || 3);
const ARTICLE_FETCH_CONCURRENCY = Number(process.env.ARTICLE_FETCH_CONCURRENCY || 4);
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY || 5);
const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 10000);

const GOOGLE_NEWS_QUERIES = [
  // Iraqi domestic politics / government / parliament
  '"العراق" "مجلس الوزراء"',
  '"العراق" "رئيس الوزراء"',
  '"محمد شياع السوداني"',
  '"العراق" "مجلس النواب"',
  '"البرلمان العراقي"',
  '"العراق" "الانتخابات"',
  '"الإطار التنسيقي"',
  '"نوري المالكي"',
  '"مقتدى الصدر"',
  '"التيار الصدري"',
  '"الحشد الشعبي" "السياسة"',
  '"النزاهة" "العراق"',
  '"الهيئة الوطنية للاستثمار"',
  '"رئيس الهيئة الوطنية للاستثمار"',
  '"العراق" "مكافحة الفساد"',

  // Security / terrorism
  '"العراق" "داعش"',
  '"بغداد" "داعش"',
  '"كركوك" "داعش"',
  '"العراق" "هجوم"',
  '"العراق" "صاروخ"',
  '"العراق" "قصف"',
  '"بغداد" "خطف"',
  '"ميسان" "صاروخ"',
  '"ديالى" "داعش"',
  '"الأنبار" "داعش"',
  '"العراق" "الوضع الأمني"',
  '"العراق" "تظاهرات"',

  // Economy / oil / budget / construction
  '"العراق" "النفط"',
  '"العراق" "أوبك"',
  '"العراق" "الموازنة"',
  '"العراق" "الكهرباء"',
  '"العراق" "الاقتصاد"',
  '"العراق" "الاستثمار"',
  '"العراق" "وزارة الإعمار والإسكان"',
  '"العراق" "أزمة السكن"',
  '"العراق" "مشاريع البنى التحتية"',
  '"العراق" "مدن سكنية"',
  '"العراق" "توزيع الأراضي"',
  '"العراق" "سعر الصرف"',

  // Regional / international but Iraq-relevant
  '"العراق" "إيران" "الولايات المتحدة"',
  '"العراق" "إسرائيل" "إيران"',
  '"العراق" "سوريا" "أمن"',
  '"العراق" "غزة"',
  '"العراق" "الحوثي"',
  '"العراق" "القواعد الأمريكية"',
  '"الحرس الثوري" "العراق"',
  '"مضيق هرمز" "العراق"',
  '"الخليج" "العراق" "أمن"',

  // English queries
  '"Iraq" "Council of Ministers"',
  '"Iraq" "Al-Sudani"',
  '"Iraq" "parliament" "election"',
  '"Iraq" "Coordination Framework"',
  '"Iraq" "Nouri al-Maliki"',
  '"Iraq" "Sadr"',
  '"Iraq" "ISIS"',
  '"Iraq" "rocket attack"',
  '"Iraq" "oil" "OPEC"',
  '"Iraq" "budget"',
  '"Iraq" "housing project"',
  '"Iraq" "Iran" "United States"',
  '"Iraq" "US bases" "Iran"'
];

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
function articleText(item = {}) { return [item.title, item.description, item.cleanText, item.fullText, item.titleKo, item.summaryKo].filter(Boolean).join("\n"); }
function hasAny(text = "", terms = []) { const normalized = stripArabicDiacritics(String(text || "").toLowerCase()); return terms.some((term) => normalized.includes(stripArabicDiacritics(String(term || "").toLowerCase()))); }

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
function googleNewsRssUrl(query) { const params = new URLSearchParams({ q: `${query} when:${DAYS}d`, hl: "ar", gl: "IQ", ceid: "IQ:ar" }); return `https://news.google.com/rss/search?${params.toString()}`; }
function parseRssItems(xml = "", query = "") {
  const blocks = String(xml || "").match(/<item>[\s\S]*?<\/item>/gi) || [];
  return blocks.map((block) => {
    const rawTitle = extractTag(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    const source = sourceMatch ? decodeHtml(sourceMatch[1]) : (String(rawTitle).split(" - ").pop() || "Google News");
    const pubDate = extractTag(block, "pubDate");
    return {
      id: `rss-${Buffer.from(normalizeUrl(extractTag(block, "link")) || rawTitle).toString("base64url").slice(0, 16)}`,
      title: rawTitle,
      titleKo: "",
      summaryKo: "",
      source,
      publishedAt: pubDate ? new Date(pubDate).toISOString() : "",
      url: normalizeUrl(extractTag(block, "link")),
      query,
      description: stripTags(extractTag(block, "description")),
      collectionMethod: "google-news-rss",
      sourceType: "google-news-rss"
    };
  }).filter((item) => item.title && item.url);
}

function scoreCandidate(item = {}) {
  const text = articleText(item);
  const excluded = [];
  if (/ladbrokes|betting|odds|fixture|score|football|soccer|match|cup|world cup|youtube|tiktok|مباراة|منتخب|كرة|الدوري/i.test(text)) excluded.push("스포츠/베팅/영상성");
  if (excluded.length) return { score: -999, category3: "exclude", reportUsefulness: "exclude", reason: excluded.join(", ") };

  const iraqContext = hasAny(text, ["العراق", "عراقي", "بغداد", "البصرة", "كركوك", "ديالى", "ميسان", "الأنبار", "نينوى", "iraq", "iraqi", "baghdad", "basra", "kirkuk", "erbil", "이라크", "바그다드"]);
  const regionalIraqLink = hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"]);
  if (!iraqContext && !regionalIraqLink) return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "이라크 맥락 부족" };

  let score = 35;
  let category3 = "politics";
  let reason = "이라크 주간 정세 참고자료";

  if (iraqContext && hasAny(text, ["مجلس الوزراء", "رئيس الوزراء", "السوداني", "مجلس النواب", "البرلمان", "انتخابات", "حكومة", "الإطار التنسيقي", "المالكي", "الصدر", "النزاهة", "فساد", "استجواب", "هيئة الاستثمار", "cabinet", "parliament", "election", "government", "corruption", "정치", "의회", "정부", "선거"])) {
    score = Math.max(score, 72); category3 = "politics"; reason = "정치권 동향 후보";
  }
  if (iraqContext && hasAny(text, ["داعش", "إرهاب", "ارهاب", "هجوم", "اشتباك", "قصف", "صاروخ", "طائرة مسيرة", "خطف", "اغتيال", "تفجير", "تظاهرات", "security", "isis", "terror", "attack", "rocket", "kidnap", "protest", "치안", "테러", "공격", "납치", "시위"])) {
    score = Math.max(score, 78); category3 = "terror_security"; reason = "치안/테러 상황 후보";
  }
  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {
    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";
  }
  if (regionalIraqLink && hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"])) {
    score = Math.max(score, iraqContext ? 64 : 55); category3 = "regional"; reason = "이라크와 연결 가능한 국제정세 후보";
  }

  return { score, category3, reportUsefulness: score >= 70 ? "include" : score >= 50 ? "watch" : "exclude", reason };
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
function parseArticleHtml(html = "", url = "", source = {}, fallbackDate = "") { const title = extractMetaContent(html, ["og:title", "twitter:title", "title"]) || stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "") || stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""); if (!title || title.length < 4) return null; const cleanText = extractReadableText(html); const desc = [extractMetaContent(html, ["og:description", "twitter:description", "description"]), cleanText.slice(0, 2500)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); return { id: `direct-${Buffer.from(normalizeUrl(url)).toString("base64url").slice(0, 16)}`, title, source: source.name || hostnameOf(url) || "Iraq media", publishedAt: extractPublishedAt(html, fallbackDate), url: normalizeUrl(url), description: desc, cleanText, fullText: cleanText, collectionMethod: "iraq-media-direct", sourceType: "iraq-media-direct" }; }

async function collectGoogleNews() {
  const results = await mapLimit(GOOGLE_NEWS_QUERIES, GOOGLE_QUERY_CONCURRENCY, async (query) => {
    try {
      const xml = await fetchText(googleNewsRssUrl(query));
      const items = parseRssItems(xml, query).slice(0, MAX_PER_QUERY).map(applyInitialScore).filter((x) => x.reportUsefulness !== "exclude");
      console.log(`[google] ${query}: ${items.length}`);
      return { items, debug: { query, ok: true, count: items.length } };
    } catch (err) {
      console.warn(`[google] ${query}: ${err.message || err}`);
      return { items: [], debug: { query, ok: false, error: String(err.message || err) } };
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
        const rssItems = parseRssItems(text, `source:${source.id}`).slice(0, MAX_PER_QUERY);
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

function uniqueRecent(items, limit = MAX_TOTAL) {
  const cutoff = cutoffDate();
  const map = new Map();
  for (const item of items) {
    if (item.publishedAt) { const d = new Date(item.publishedAt); if (!Number.isNaN(d.getTime()) && d < cutoff) continue; }
    const key = canonicalKey(item);
    if (!key) continue;
    const old = map.get(key);
    if (!old || Number(item.importanceScore || 0) > Number(old.importanceScore || 0)) map.set(key, item);
  }
  return [...map.values()].sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0)).slice(0, limit);
}

function hasReusableAiSummary(item = {}) { return !!(item.titleKo && item.summaryKo && !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) && !item.translationFailed); }
function reuseFromPrevious(item, previousMap) { const cached = previousMap.get(canonicalKey(item)); return cached && hasReusableAiSummary(cached) ? { ...item, ...cached, url: item.url || cached.url, source: item.source || cached.source, aiCacheHit: true } : { ...item, aiCacheHit: false }; }
async function loadPreviousMap() { const map = new Map(); try { const prev = JSON.parse(await fs.readFile(NEWS_FILE, "utf8")); for (const item of prev.articles || []) if (hasReusableAiSummary(item)) map.set(canonicalKey(item), item); } catch {} return map; }

async function aiKorean(prompt, input) {
  const res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model: OPENAI_SUMMARY_MODEL, temperature: 0.1, input: [{ role: "system", content: "You classify Iraq news for a Korean weekly situation report. Output valid JSON only." }, { role: "user", content: `${prompt}\n\n기사 데이터:\n${input}` }] }) });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.output_text || (data.output || []).flatMap((o) => o.content || []).map((c) => c.text || "").join("\n");
}
function parseJsonObject(text = "") { const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(); try { return JSON.parse(raw); } catch {} const m = raw.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return null; }
function clean(value = "") { return String(value || "").replace(/^[-*·•\s]+/, "").replace(/^☞\s*/, "").replace(/\s+/g, " ").trim(); }
function normalizeArray(value, limit = 3) { if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, limit); if (typeof value === "string") return value.split(/\n+|(?<=\.)\s+/).map(clean).filter(Boolean).slice(0, limit); return []; }
function clampScore(value, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback; }
function normalizeCategory3(v = "", fallback = "politics") { const x = String(v || "").trim(); return ["politics", "terror_security", "oil_economy", "regional", "exclude"].includes(x) ? x : fallback; }

async function enrichArticle(item) {
  if (!OPENAI_API_KEY) return item;
  const text = normalizeText(item.cleanText || item.fullText || item.description || "").slice(0, MAX_ARTICLE_TEXT_CHARS);
  const input = JSON.stringify({ title: item.title, source: item.source, publishedAt: item.publishedAt, url: item.url, description: item.description, text, initialCategory: item.category3, initialReason: item.weeklyReportReason }, null, 2);
  const prompt = [
    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",
    "반드시 JSON 객체만 출력하라. 마크다운 금지.",
    "필수 키:",
    "titleKo, summaryKo, category1, category2, category3, importanceScore, reportUsefulness, weeklyReportReason, reportBullet, reportSubBullets, reportImplication, actors, location, sourceReliability",
    "category1은 domestic 또는 international.",
    "category2는 politics_security, economy, international 중 하나.",
    "category3는 politics, terror_security, oil_economy, regional, exclude 중 하나.",
    "summaryKo는 3~5줄 한국어 요약. 제목 반복 금지.",
    "reportBullet은 '- ' 없이 'M.D, 주체, 핵심행위 명사형.' 구조. 예: '7.4, 이라크 의회, NIC 의장 심문 결정.'",
    "reportSubBullets는 '* ' 없이 0~2개.",
    "reportImplication은 '☞' 없이 1문장 또는 빈 문자열.",
    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~조치로 해석', '~가능성', '~필요', '~전망' 형태를 우선한다.",
    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",
    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."
  ].join("\n");
  try {
    const parsed = parseJsonObject(await aiKorean(prompt, input));
    if (!parsed || !parsed.titleKo || !parsed.summaryKo || hasArabic(parsed.titleKo) || hasArabic(parsed.summaryKo)) throw new Error("bad AI JSON");
    const category3 = normalizeCategory3(parsed.category3, item.category3);
    return {
      ...item,
      titleKo: clean(parsed.titleKo),
      summaryKo: String(parsed.summaryKo || "").trim(),
      category1: parsed.category1 === "international" || category3 === "regional" ? "international" : "domestic",
      category2: ["politics_security", "economy", "international"].includes(parsed.category2) ? parsed.category2 : (category3 === "oil_economy" ? "economy" : category3 === "regional" ? "international" : "politics_security"),
      category3,
      importanceScore: clampScore(parsed.importanceScore, item.importanceScore || 50),
      reportUsefulness: ["include", "watch", "exclude"].includes(parsed.reportUsefulness) ? parsed.reportUsefulness : item.reportUsefulness,
      weeklyReportReason: clean(parsed.weeklyReportReason || item.weeklyReportReason),
      reportBullet: clean(parsed.reportBullet),
      reportSubBullets: normalizeArray(parsed.reportSubBullets, 2),
      reportImplication: clean(parsed.reportImplication),
      actors: normalizeArray(parsed.actors, 8),
      location: clean(parsed.location),
      sourceReliability: clean(parsed.sourceReliability || "일반 언론"),
      selected: false,
      aiSummaryVersion: "weekly-report-v1"
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
  const previousMap = await loadPreviousMap();
  articles = articles.map((item) => reuseFromPrevious(item, previousMap));
  const cacheHits = articles.filter((x) => x.aiCacheHit).length;
  const toEnrich = articles.filter((x) => !x.aiCacheHit);
  const enriched = OPENAI_API_KEY ? await mapLimit(toEnrich, AI_CONCURRENCY, enrichArticle) : toEnrich;
  const enrichedMap = new Map(enriched.map((item) => [canonicalKey(item), item]));
  articles = articles.map((item) => item.aiCacheHit ? item : (enrichedMap.get(canonicalKey(item)) || item)).filter((item) => item.reportUsefulness !== "exclude" || item.category3 === "exclude");

  const counts = {
    total: articles.length,
    politics: articles.filter((x) => x.category3 === "politics").length,
    terror_security: articles.filter((x) => x.category3 === "terror_security").length,
    oil_economy: articles.filter((x) => x.category3 === "oil_economy").length,
    regional: articles.filter((x) => x.category3 === "regional").length,
    exclude: articles.filter((x) => x.category3 === "exclude" || x.reportUsefulness === "exclude").length
  };

  const generatedAt = nowIso();
  const payload = { category: "iraq-weekly-report-news", generatedAt, lookbackDays: DAYS, count: articles.length, cacheHits, model: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none", counts, articles, debug: { google: google.debug, direct: direct.debug, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) } };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");
  await fs.writeFile(INDEX_FILE, JSON.stringify({ generatedAt, source: "collect-news.mjs", files: { news: "data/news.json" }, counts, elapsedSeconds: payload.debug.elapsedSeconds }, null, 2), "utf8");
  console.log(`Done. articles=${articles.length}, cacheHits=${cacheHits}, elapsed=${payload.debug.elapsedSeconds}s`);
}

async function mapLimit(arr, limit, fn) {
  const ret = [];
  let idx = 0;
  async function worker() { while (idx < arr.length) { const cur = idx++; ret[cur] = await fn(arr[cur], cur); } }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length) }, worker));
  return ret;
}

main().catch((err) => { console.error(err); process.exit(1); });
