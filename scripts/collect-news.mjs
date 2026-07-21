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
const DAYS = Number(process.env.NEWS_LOOKBACK_DAYS || 30);
const MAX_PER_QUERY = Number(process.env.MAX_PER_QUERY || 12);
const MAX_TOTAL = Number(process.env.MAX_TOTAL || 260);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const GOOGLE_QUERY_CONCURRENCY = Number(process.env.GOOGLE_QUERY_CONCURRENCY || 6);
const SOURCE_CONCURRENCY = Number(process.env.SOURCE_CONCURRENCY || 3);
const ARTICLE_FETCH_CONCURRENCY = Number(process.env.ARTICLE_FETCH_CONCURRENCY || 4);
const AI_CONCURRENCY = Number(process.env.AI_CONCURRENCY || 5);
const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 10000);
const FULLTEXT_HYDRATION_CONCURRENCY = Number(process.env.FULLTEXT_HYDRATION_CONCURRENCY || 4);
const MIN_FULLTEXT_CHARS_FOR_AI = Number(process.env.MIN_FULLTEXT_CHARS_FOR_AI || 500);
const MIN_RSS_DESCRIPTION_CHARS_FOR_AI = Number(process.env.MIN_RSS_DESCRIPTION_CHARS_FOR_AI || 300);
const HIGH_PRIORITY_RSS_FALLBACK_SCORE = Number(process.env.HIGH_PRIORITY_RSS_FALLBACK_SCORE || 90);
const MAX_NEW_AI_ITEMS = Number(process.env.MAX_NEW_AI_ITEMS || 120);

async function loadGoogleNewsQueries() {
  const config = JSON.parse(await fs.readFile(SEARCH_KEYWORDS_FILE, "utf8"));
  const queries = Object.entries(config)
    .filter(([key]) => !key.startsWith("_"))
    .flatMap(([, values]) => Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!queries.length) throw new Error("No Google News queries configured in data/search-keywords.json");
  if (new Set(queries).size !== queries.length) throw new Error("Duplicate Google News queries found in data/search-keywords.json");
  return queries;
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
      id: stableArticleId("rss", normalizeUrl(extractTag(block, "link")) || rawTitle),
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
  const titleAndUrl = `${item.title || ""}\n${item.url || ""}`;
  const excluded = [];
  if (/ladbrokes|betting|odds|fixture|score|football|soccer|match|cup|world cup|youtube|tiktok|مباراة|منتخب|كرة|الدوري/i.test(text)) excluded.push("스포츠/베팅/영상성");
  if (/alsumaria\.tv\/watch\/|\b(?:MIC|Live Talk)\b|الممثلة|الممثل|الفنان|أبراج|ترفيه|منوعات|استديو|الحلقة\s*[٠-٩0-9]+/i.test(titleAndUrl)) excluded.push("연예/방송 프로그램");
  if (excluded.length) return { score: -999, category3: "exclude", reportUsefulness: "exclude", reason: excluded.join(", ") };

  const iraqContext = hasAny(text, ["العراق", "عراقي", "بغداد", "البصرة", "كركوك", "ديالى", "ميسان", "الأنبار", "نينوى", "iraq", "iraqi", "baghdad", "basra", "kirkuk", "erbil", "이라크", "바그다드"]);
  const bismayahDirect = hasAny(text, ["بسماية", "بسمايه", "مشروع بسماية", "مدينة بسماية", "مدينة بسماية الجديدة", "مجمع بسماية", "bismayah", "비스마야"]);
  const bismayahStakeholder = hasAny(text, ["حيدر مكية", "حيدر مكيه", "عادل الياسري", "شركة هانوا", "هانوا", "hanwha"]);
  const bismayahInstitutional = hasAny(text, ["الهيئة الوطنية للاستثمار", "هيئة الاستثمار", "مشروع سكني في العراق", "مدينة سكنية في العراق", "شركة كورية"]);
  const regionalIraqLink = hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"]);
  if (!iraqContext && !regionalIraqLink && !bismayahDirect && !bismayahStakeholder) return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "이라크 맥락 부족" };

  if (bismayahDirect) {
    return { score: 100, category3: "oil_economy", reportUsefulness: "include", reason: "비스마야 사업 직접 관련 최우선 기사" };
  }
  if (bismayahStakeholder && (iraqContext || bismayahInstitutional)) {
    return { score: 96, category3: "oil_economy", reportUsefulness: "include", reason: "비스마야·한화·핵심 관계자 관련 최우선 기사" };
  }
  if (iraqContext && bismayahInstitutional) {
    return { score: 90, category3: "oil_economy", reportUsefulness: "include", reason: "NIC·이라크 주택사업 관련 주요 사업환경 기사" };
  }

  let score = 35;
  let category3 = "politics";
  let reason = "이라크 주간 정세 참고자료";

  if (iraqContext && hasAny(text, ["مجلس الوزراء", "رئيس الوزراء", "السوداني", "مجلس النواب", "البرلمان", "انتخابات", "حكومة", "الإطار التنسيقي", "المالكي", "الصدر", "النزاهة", "فساد", "استجواب", "هيئة الاستثمار", "cabinet", "parliament", "election", "government", "corruption", "정치", "의회", "정부", "선거"])) {
    score = Math.max(score, 72); category3 = "politics"; reason = "정치권 동향 후보";
  }
  if (iraqContext && hasAny(text, ["الحقائب الوزارية", "المرشحين للوزارات", "مرشحي الوزارات", "المرشحون للوزارات", "الكابينة الوزارية", "اكتمال الكابينة", "استكمال الكابينة", "الخلافات الداخلية", "زيارة واشنطن", "زيارة الولايات المتحدة", "التصويت على الوزراء", "منح الثقة", "جلسة مجلس النواب", "استئناف جلساته", "إعفاء رئيس الهيئة الوطنية للاستثمار", "إقالة رئيس الهيئة الوطنية للاستثمار", "رئيس الهيئة الوطنية للاستثمار", "هيئة النزاهة", "إحالته إلى النزاهة", "ملفات الفساد", "ministerial candidates", "ministerial portfolios", "cabinet completion", "complete the cabinet", "internal disputes", "internal conflict", "washington visit", "us visit", "confidence vote", "vote of confidence", "resume session", "National Investment Commission", "NIC chair", "NIC chairman", "dismissal", "Integrity Commission", "corruption files", "장관 후보자", "장관 후보", "내각 완성", "내각 구성", "내각 지연", "총리 방미", "미국 방문", "방미 이후", "내부 갈등", "신임투표", "신임 투표", "본회의 재개", "NIC 의장 해임", "국가투자위원회 의장 해임", "청렴위원회 이관", "부패 의혹"])) {
    score = Math.max(score, 88);
    category3 = "politics";
    reason = "내각 구성·의회 표결·NIC 해임 관련 핵심 정국 후보";
  }
  if (iraqContext && hasAny(text, ["الحشد الشعبي", "سليماني", "السيستاني", "الصدر", "نزع السلاح", "حل الحشد", "PMF", "Popular Mobilization", "Soleimani", "Sistani", "disband", "disarm", "weapons", "인민동원군", "무장해제", "해체", "Soleimani", "Al-Sadr", "Al-Sistani"])) {
    score = Math.max(score, 86);
    category3 = "politics";
    reason = "PMF·친이란 무장조직·이라크 주권 관련 핵심 정국 후보";
  }
  if (iraqContext && hasAny(text, ["داعش", "إرهاب", "ارهاب", "هجوم", "اشتباك", "قصف", "صاروخ", "طائرة مسيرة", "خطف", "اغتيال", "تفجير", "تظاهرات", "security", "isis", "terror", "attack", "rocket", "kidnap", "protest", "치안", "테러", "공격", "납치", "시위"])) {
    score = Math.max(score, 78); category3 = "terror_security"; reason = "치안/테러 상황 후보";
  }
  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {
    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";
  }
  if (iraqContext && hasAny(text, ["وزارة الإعمار والإسكان", "الاعمار والاسكان", "الإعمار والإسكان", "المدن السكنية", "مدينة سكنية", "مدن سكنية", "المدن الجديدة", "مدينة جديدة", "معايير بيئية", "المعايير البيئية", "معايير التخطيط", "التخطيط العمراني", "التخطيط الحضري", "العزل الحراري", "مواد العزل", "المساحات الخضراء", "نسبة المساحات الخضراء", "نسبة الخضراء", "مواد البناء المحلية", "المواد الإنشائية المحلية", "مواد انشائية محلية", "construction and housing ministry", "ministry of construction and housing", "new residential cities", "environmental standards", "urban planning standards", "insulation", "green space", "green spaces", "local construction materials", "건설주택부", "신규 주거도시", "주거도시", "환경기준", "환경 기준", "도시계획", "도시 계획", "단열재", "녹지", "자국 건설자재", "국산 건설자재"])) {
    score = Math.max(score, 82);
    category3 = "oil_economy";
    reason = "주거도시 개발·환경/도시계획 기준 후보";
  }
  if (regionalIraqLink && hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"])) {
    score = Math.max(score, iraqContext ? 64 : 55); category3 = "regional"; reason = "이라크와 연결 가능한 국제정세 후보";
  }
  if (hasAny(text, ["الحرس الثوري", "مضيق هرمز", "قواعد أمريكية", "البحرين", "الكويت", "مذكرة تفاهم", "قسد", "الجيش الوطني السوري", "مخيمات داعش", "حماس", "رهائن", "IRGC", "Hormuz", "US bases", "Bahrain", "Kuwait", "memorandum", "SDF", "SNA", "ISIS camps", "Hamas", "hostages", "혁명수비대", "호르무즈", "미군기지", "바레인", "쿠웨이트", "시리아민주군", "시리아국가군", "가자", "하마스", "인질"])) {
    score = Math.max(score, 76);
    category3 = "regional";
    reason = "美·이스라엘-이란 분쟁 또는 시리아·가자 관련 국제정세 핵심 후보";
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
function parseArticleHtml(html = "", url = "", source = {}, fallbackDate = "") { const title = extractMetaContent(html, ["og:title", "twitter:title", "title"]) || stripTags((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || "") || stripTags((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || ""); if (!title || title.length < 4) return null; const cleanText = extractReadableText(html); const desc = [extractMetaContent(html, ["og:description", "twitter:description", "description"]), cleanText.slice(0, 2500)].filter(Boolean).join(" ").replace(/\s+/g, " ").trim(); return { id: stableArticleId("direct", normalizeUrl(url)), title, source: source.name || hostnameOf(url) || "Iraq media", publishedAt: extractPublishedAt(html, fallbackDate), url: normalizeUrl(url), description: desc, cleanText, fullText: cleanText, collectionMethod: "iraq-media-direct", sourceType: "iraq-media-direct" }; }

function sourceEvidenceText(item = {}) {
  return normalizeText(item.cleanText || item.fullText || item.description || "");
}

function hasUsableFullText(item = {}) {
  return normalizeText(item.cleanText || item.fullText || "").length >= MIN_FULLTEXT_CHARS_FOR_AI;
}

function evidenceLevelFor(item = {}) {
  if (hasUsableFullText(item)) return "fulltext";
  if (normalizeText(item.description || "").length >= MIN_RSS_DESCRIPTION_CHARS_FOR_AI) return "rss-description";
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

function isExcludedNinaArticle(item = {}) {
  const source = String(item.source || item.publisher || "").trim();
  const url = String(item.url || item.link || item.resolvedUrl || "");
  return /^(NINA|وكالة الانباء العراقية \(نينا\)|وكالة الأنباء العراقية \(نينا\))$/i.test(source) ||
    /ninanews\.com/i.test(url);
}

function weeklyReportTitleText(item = {}) {
  return [item.title, item.titleKo, item.query].filter(Boolean).join("\n");
}

function hasWeeklyReportScope(item = {}) {
  const title = weeklyReportTitleText(item);

  const directIraqOrProject = hasAny(title, [
    "العراق", "عراقي", "بغداد", "البصرة", "كركوك", "أربيل", "النجف", "كربلاء", "الأنبار", "نينوى", "ديالى", "ميسان",
    "مجلس الوزراء", "رئيس الوزراء", "مجلس النواب", "البرلمان العراقي", "الإطار التنسيقي", "الحشد الشعبي",
    "الهيئة الوطنية للاستثمار", "هيئة الاستثمار", "بسماية", "بسمايه", "هانوا", "حيدر مكية", "عادل الياسري",
    "iraq", "iraqi", "baghdad", "basra", "kirkuk", "erbil", "najaf", "karbala", "pmf", "coordination framework",
    "national investment commission", "bismayah", "bismaya", "bncp", "hanwha",
    "이라크", "바그다드", "비스마야", "한화", "국가투자위원회", "시아조정기구", "인민동원군"
  ]);

  const strategicMiddleEast = hasAny(title, [
    "إيران", "إسرائيل", "فلسطين", "غزة", "الضفة الغربية", "سوريا", "الحوثي", "البحر الأحمر", "مضيق هرمز",
    "الحرس الثوري", "القواعد الأمريكية", "لبنان", "حزب الله", "حماس",
    "iran", "israel", "palestine", "gaza", "west bank", "syria", "houthi", "red sea", "hormuz", "irgc", "us bases",
    "lebanon", "hezbollah", "hamas",
    "이란", "이스라엘", "팔레스타인", "가자", "서안", "시리아", "후티", "홍해", "호르무즈", "혁명수비대", "미군기지", "레바논", "헤즈볼라", "하마스"
  ]);

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
  return true;
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
    item.aiSummaryVersion === "weekly-report-v5-evidence" &&
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
  const request = (model) => fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: [{ role: "system", content: "You classify Iraq news for a Korean weekly situation report. Output valid JSON only." }, { role: "user", content: `${prompt}\n\n기사 데이터:\n${input}` }] }) });
  const attemptedModel = activeSummaryModel;
  let res = await request(attemptedModel);
  if (!res.ok) {
    const errorText = await res.text();
    const modelUnavailable = res.status === 404 && /model_not_found|must be verified|verified to use/i.test(errorText);
    if (modelUnavailable && OPENAI_SUMMARY_FALLBACK_MODEL && attemptedModel !== OPENAI_SUMMARY_FALLBACK_MODEL) {
      activeSummaryModel = OPENAI_SUMMARY_FALLBACK_MODEL;
      if (!summaryFallbackLogged) {
        console.warn(`[ai] ${OPENAI_SUMMARY_MODEL} unavailable; falling back to ${activeSummaryModel}`);
        summaryFallbackLogged = true;
      }
      res = await request(activeSummaryModel);
    } else {
      throw new Error(`OpenAI ${res.status}: ${errorText}`);
    }
  }
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
  const input = JSON.stringify({
    title: item.title,
    source: item.source,
    publishedAt: item.publishedAt,
    url: item.url,
    description: item.description,
    text,
    sourceEvidenceLevel: item.sourceEvidenceLevel || evidenceLevelFor(item),
    sourceEvidenceChars: Number(item.sourceEvidenceChars || sourceEvidenceText(item).length),
    initialCategory: item.category3,
    initialReason: item.weeklyReportReason
  }, null, 2);
  const prompt = [
    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",
    "원문을 별도로 요약한 뒤 다시 번역하지 말고, 제공된 원문 근거에서 바로 한국어 핵심 요약을 한 번에 작성하라.",
    "국가명·기관명·인명·날짜·수치·투자 대상은 원문 표기를 보존하고 서로 다른 기사나 배경지식을 섞지 말라.",
    "sourceEvidenceLevel이 fulltext이면 본문 전체를 우선하고, rss-description이면 제목·설명에서 확인되는 사실 이상으로 확대하지 말라.",
    "비스마야·BNCP·한화·NIC·하이더 마키야·아델 알야시리 관련 보도는 사업 핵심 뉴스로 보고 최우선(include, 높은 중요도) 처리하라.",
    "반드시 JSON 객체만 출력하라. 마크다운 금지.",
    "필수 키:",
    "titleKo, summaryKo, category1, category2, category3, importanceScore, reportUsefulness, weeklyReportReason, reportBullet, reportSubBullets, reportImplication, actors, location, sourceReliability",
    "category1은 domestic 또는 international.",
    "category2는 politics_security, economy, international 중 하나.",
    "category3는 politics, terror_security, oil_economy, regional, exclude 중 하나.",
    "summaryKo는 3~5줄 한국어 요약. 제목 문장을 그대로 반복하지 말고, 기사 본문에서 확인되는 핵심 주장·비판 대상·조건·정치적 의미를 압축하라.",
    "제목이 자극적이거나 일부 발언만 강조한 경우 제목을 따라가지 말고 본문 전체의 핵심 정치 메시지를 우선하라.",
    "정치인 인터뷰·논평·발언 기사는 반드시 다음 축을 확인하라: ① 누구를 지지/비판했는지, ② 어떤 정부·정당·기관을 겨냥했는지, ③ 구체 사례/부문/표현이 있는지, ④ 단서·조건·선 긋기가 있는지, ⑤ 이것이 정치적 방어선 또는 연정 내부 신호인지.",
    "반부패·체포·압수수색·부패 폭로 기사에서는 단순히 '반부패 필요'라고 쓰지 말고, 전 정부 비판인지, 신임 총리 지지인지, 법적 절차 요구인지, 특정 세력 견제인지 구분하라.",
    "보고서 전체 문체는 사람이 작성한 정세보고 문체를 따른다. 간결한 명사형·음슴체를 사용하고 장황한 설명문을 피하라.",
    "reportBullet은 '- ' 없이 'M.D, 주체, 핵심행위/결과' 구조로 1문장만 작성하라. 예: '7.4, 시아조정기구(SCF) 소식통, 내부 갈등으로 인한 장관 후보자 미확정으로 내각 완성은 총리 방미 이후 전망'.",
    "reportBullet의 주체는 기관·인물·언론·소식통을 명확히 적어라. 예: 'Al-Zaidi 총리', '이라크 의회', '시아조정기구(SCF) 소식통', '혁명수비대(IRGC)', '美 중부사령부'.",
    "reportBullet에서는 '이라크 정치 조정 기구', '정치적 조정 기구'라고 쓰지 말고 반드시 '시아조정기구(SCF)'로 표기하라.",
    "reportBullet과 reportSubBullets에서 '자이드 정부'라고 쓰지 말고 'Al-Zaidi 총리' 또는 'Al-Zaidi 총리 내각'으로 표기하라.",
    "인명·기관명은 보고서식 표기를 사용하라: Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리, Al-Sadr, Al-Sistani, Khamenei, Soleimani, Pezeshkian 대통령, Trump 대통령, 인민동원군(PMF), 혁명수비대(IRGC), 시리아민주군(SDF), 시리아국가군(SNA).",
    "지명은 가능하면 영문식으로 표기하라: Baghdad, Teheran, Najaf, Karbala, Qom, Salah al-Din州, Baghdad州.",
    "reportSubBullets는 '* ' 없이 1~3개. reportBullet을 반복하지 말고, 발언 배경·비판 대상·구체 사례·조건부 입장·정책 의미를 각각 1문장으로 작성하라.",
    "정치인 인터뷰/발언 기사 reportSubBullets 구성 예시: ① 전 정부 또는 경쟁 세력에 대한 비판, ② 부패·치안·내각 등 구체 쟁점, ③ 지지하되 법적 절차·제도적 통제 필요 등 단서.",
    "reportSubBullets 예시: '전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었다고 비판', '전력·항만 등 주요 부문에서 부패 확산을 지적', '반부패 작전 지속 필요성을 인정하면서도 법적 절차와 제도적 기준 내 진행 필요성 언급'.",
    "reportImplication은 '☞' 없이 0~1문장. 분석 기사, 배경설명, 조직 정의, 파급효과가 분명할 때만 작성하라. 근거가 약하면 빈 문자열로 둬라.",
    "reportImplication은 '정치적 압박 강화 가능성', '정치적 의지 강화 가능성' 같은 일반론을 금지한다. 구체적 분석 축을 써라.",
    "정치인 발언의 시사점은 '공개 지지', '조건부 지지', '정치적 방어선', '연정 내부 견제', '전 정부 책임론', '수사 확대 가능성 차단' 중 실제 근거가 있는 축으로 작성하라.",
    "reportImplication 예시: 'Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석.', '인민동원군(PMF) : IS 격퇴를 위해 창설된 非정규군으로 친이란 무장단체들이 소속되어 있어 이란 영향력 하 운영.'",
    "美·이스라엘-이란 분쟁, 시리아 SDF-SNA 교전, 가자/하마스 인질 관련 기사는 국제사회 섹션 후보로 적극 분류하라.",
    "PMF 해체·무장해제, Al-Sadr·Al-Sistani의 PMF 관련 입장, Soleimani 추모, Khamenei의 미군 철수 촉구는 이라크 국내 정치/치안 동향 후보로 적극 분류하라.",
    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~참석', '~강조', '~비판', '~지지', '~조건 제시', '~전망', '~제기', '~촉구', '~체결', '~승인', '~감행', '~시사' 형태를 우선한다.",
    "기사 제목이 '전투탱크', '공격하고 싶어했다'처럼 부분 발언을 강조하더라도, 그것이 본문의 핵심이 아니면 reportBullet의 중심으로 삼지 말고 보조 설명으로 낮춰라.",
    "한 문단 안에서 같은 사실을 두 번 반복하지 말라. reportBullet에 쓴 문장을 reportSubBullets에서 다시 풀어쓰지 말라.",
    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",
    "영국·유럽·미국 등 제3국의 현지 범죄·테러·반이슬람 사건은 이라크 정부·국민·공관·사업 또는 중동 안보에 직접 연결되지 않으면 반드시 exclude 처리하라.",
    "제3국의 현지 치안 사건을 '이라크 주간 테러 상황'으로 분류하지 말라.",
    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "시아조정기구(SCF) 내부 갈등, 장관 후보자 미확정, 내각 완성 지연, 총리 방미 이후 전망, 의회 본회의 재개, 장관 신임투표 미실시, NIC 의장 해임안, 청렴위원회 이관 관련 기사는 정치권 동향 핵심 후보로 적극 분류하라.",
    "건설주택부의 신규 주거도시, 환경기준, 도시계획 기준, 단열재, 녹지비율, 자국 건설자재 우선 사용 관련 기사는 주간보고서 경제/투자환경 후보로 적극 분류하라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."
  ].join("\n");
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
      reportSubBullets: normalizeArray(parsed.reportSubBullets, 3),
      reportImplication: clean(parsed.reportImplication),
      actors: normalizeArray(parsed.actors, 8),
      location: clean(parsed.location),
      sourceReliability: clean(parsed.sourceReliability || "일반 언론"),
      selected: false,
      aiSummaryVersion: "weekly-report-v5-evidence"
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
  articles = articles.map((item) => reuseFromPrevious(item, previousMap));
  const cacheHits = articles.filter((x) => x.aiCacheHit).length;
  const toHydrate = articles.filter((x) => !x.aiCacheHit);
  const hydrated = await mapLimit(toHydrate, FULLTEXT_HYDRATION_CONCURRENCY, hydrateSelectedArticle);
  let hydratedIndex = 0;
  articles = articles.map((item) => item.aiCacheHit ? item : (hydrated[hydratedIndex++] || item));

  const eligible = articles
    .filter((item) => !item.aiCacheHit && canSummarizeFromEvidence(item))
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
  }).filter((item) => item.reportUsefulness !== "exclude" || item.category3 === "exclude");

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

main().catch((err) => { console.error(err); process.exit(1); });
