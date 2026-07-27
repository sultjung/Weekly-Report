#!/usr/bin/env node
/**
 * Stage 2 of the Weekly-Report pipeline.
 *
 * Stage 1 (collect-news.mjs) only collects and hydrates source material.
 * This stage owns deterministic relevance/category/importance decisions, then
 * asks AI only for translation and evidence-backed factual extraction.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { FACT_EXTRACTION_VERSION, factExtractionPrompt } from "./article-fact-rules.mjs";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const FACT_MODEL = process.env.OPENAI_FACT_MODEL || "gpt-5.4-nano";
const FACT_FALLBACK_MODEL = process.env.OPENAI_FACT_FALLBACK_MODEL || "gpt-5.4-mini";
const MAX_ITEMS = Number(process.env.FACT_EXTRACTION_MAX_ITEMS || 180);
const CONCURRENCY = Number(process.env.FACT_AI_CONCURRENCY || 4);
const MIN_INTERVAL_MS = Number(process.env.FACT_AI_MIN_REQUEST_INTERVAL_MS || 1000);
const MAX_RETRIES = Number(process.env.FACT_AI_MAX_RETRIES || 3);
const RETRY_BASE_MS = Number(process.env.FACT_AI_RETRY_BASE_MS || 2000);
const MAX_EVIDENCE_CHARS = Number(process.env.FACT_MAX_EVIDENCE_CHARS || 9000);

let activeModel = FACT_MODEL;
let nextRequestAt = 0;
let fallbackLogged = false;

const IRAQ_RE = /العراق|عراقي|العراقية|بغداد|البصرة|الموصل|نينوى|أربيل|اربيل|كركوك|الأنبار|الانبار|ديالى|كربلاء|النجف|السليمانية|إقليم كردستان|اقليم كردستان|الحكومة العراقية|البرلمان العراقي|رئيس الوزراء العراقي|مجلس الوزراء العراقي|مجلس النواب العراقي|الإطار التنسيقي|الهيئة الوطنية للاستثمار|بسماية|بسمايه|هانوا|iraq|iraqi|baghdad|basra|mosul|nineveh|erbil|kirkuk|anbar|diyala|karbala|najaf|sulaymaniyah|iraqi kurdistan|kurdistan region of iraq|krg|bismayah|bismaya|bncp|hanwha|national investment commission|이라크|바그다드|바스라|모술|니나와|아르빌|에르빌|키르쿠크|안바르|디얄라|카르발라|나자프|쿠르드 자치정부|비스마야|한화|시아조정기구/iu;
const PROJECT_RE = /بسماية|بسمايه|بسمایه|هانوا|شركة هانوا|bismayah|bismaya|bncp|hanwha|비스마야|한화/iu;
const POLITICS_RE = /مجلس الوزراء|رئيس الوزراء|رئيس الحكومة|مجلس النواب|البرلمان|الحكومة|انتخابات|الإطار التنسيقي|النزاهة|فساد|مكافحة الفساد|الهيئة الوطنية للاستثمار|الحشد الشعبي|نزع السلاح|cabinet|prime minister|premier|parliament|government|election|coordination framework|corruption|anti-corruption|national investment commission|pmf|disarmament|국무회의|내각|총리|의회|정부|선거|시아조정기구|부패|청렴위원회|nic|인민동원군|무장해제/iu;
const SECURITY_RE = /داعش|إرهاب|ارهاب|هجوم مسلح|هجوم إرهابي|اشتباك|عبوة ناسفة|تفجير|انتحاري|اغتيال|إطلاق نار|اطلاق نار|قصف|صاروخ|طائرة مسيرة|خطف|اعتقال|إلقاء القبض|القاء القبض|ضبط|تظاهرات|احتجاجات|اعتصام|إغلاق الطرق|isis|terror|armed attack|clash|ied|bombing|suicide bomb|assassination|shooting|rocket|drone|kidnap|arrest|detained|seized|protest|demonstration|road closure|테러|무장 공격|교전|급조폭발물|폭탄|자살폭탄|암살|총격|로켓|드론|납치|체포|구금|압수|시위|집회|도로 통제/iu;
const OIL_RE = /국제유가|원유 가격|원유 선물|두바이유|브렌트유|서부텍사스유|\bwti\b|\bopec\+?\b|석유수출국기구|원유 공급|원유 수요|산유량|원유 수출|crude oil|oil price|oil futures|brent|west texas intermediate|dubai crude|oil supply|oil demand|oil output|oil export|أوبك|أسعار النفط|النفط الخام/iu;
const RETAIL_FUEL_RE = /휘발유|경유|주유소|기름값|유류세|리터당|자동차 연료|소비자 가격|gasoline|petrol|diesel|pump price|fuel tax|retail fuel/iu;
const GAZA_RE = /قطاع\s+غزة|غزة|فلسطين|فلسطيني(?:ة|ون|ين)?|حماس|gaza(?:\s+strip)?|palestin(?:e|ian|ians)|hamas|가자(?:\s*지구)?|팔레스타인|하마스/iu;
const REGIONAL_ACTOR_RE = /إيران|ايران|إسرائيل|اسرائيل|سوريا|الحوثي|اليمن|لبنان|حزب الله|البحر الأحمر|مضيق هرمز|باب المندب|الخليج|القواعد الأمريكية|iran|israel|syria|houthi|yemen|lebanon|hezbollah|red sea|hormuz|bab al-mandab|persian gulf|us bases|이란|이스라엘|시리아|후티|예멘|레바논|헤즈볼라|홍해|호르무즈|바브엘만데브|페르시아만|미군기지/iu;
const STRATEGIC_RE = /حرب|ضربة|ضربات|قصف|صاروخ|طائرة مسيرة|تصعيد|رد عسكري|عقوبات|إغلاق|تعطيل الملاحة|هجوم|اشتباك|إجلاء|حدود|داعش|war|strike|airstrike|bombing|missile|drone|escalation|retaliation|sanctions|closure|shipping disruption|attack|clash|evacuation|border|isis|oil supply|oil export|tanker|shipping|navigation|supply chain|전쟁|공습|폭격|미사일|드론|확전|보복|제재|봉쇄|항행|해운|대피|국경|isis|원유 공급|원유 수출|유조선|공급망/iu;
const NOISE_RE = /ladbrokes|betting|odds|fixture|football|soccer|world cup|youtube|tiktok|مباراة|منتخب|كرة|الدوري|الممثلة|الممثل|الفنان|أبراج|ترفيه|منوعات|استديو|الحلقة\s*[٠-٩0-9]+/iu;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function clean(value = "") { return String(value || "").replace(/^[-*·•\s]+/, "").replace(/^☞\s*/, "").replace(/\s+/g, " ").trim(); }
function stripArabic(value = "") { return String(value || "").replace(/[\u064B-\u065F\u0670]/g, "").replace(/\u0640/g, ""); }
function compact(value = "") { return stripArabic(value).toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ""); }
function sourceText(article = {}) { return [article.title, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n").slice(0, MAX_EVIDENCE_CHARS); }
function sourceLead(article = {}) { return [article.title, article.description, String(article.cleanText || article.fullText || "").slice(0, 3500)].filter(Boolean).join("\n"); }
function hasArabic(value = "") { return /[\u0600-\u06FF]/.test(String(value || "")); }
function hasKorean(value = "") { return /[가-힣]/.test(String(value || "")); }
function fingerprint(article = {}) { return createHash("sha256").update([article.title, article.description, article.cleanText, article.fullText, article.publishedAt].filter(Boolean).join("\n")).digest("base64url").slice(0, 24); }

export function evidenceQuoteSupported(quote = "", article = {}) {
  const q = compact(quote);
  const source = compact(sourceText(article));
  return q.length >= 6 && source.includes(q);
}

function categoryMeta(category3) {
  if (category3 === "oil_economy") return { category1: "domestic", category2: "economy" };
  if (category3 === "regional") return { category1: "international", category2: "international" };
  return { category1: "domestic", category2: "politics_security" };
}

function securityEventType(text = "") {
  if (/تظاهرات|احتجاجات|اعتصام|متظاهرين|protest|demonstration|시위|집회/iu.test(text)) return "protest";
  if (/عبوة ناسفة|\bied\b|급조폭발물/iu.test(text)) return "ied";
  if (/انتحاري|suicide bomb|자살폭탄/iu.test(text)) return "suicide_bombing";
  if (/اغتيال|assassination|암살/iu.test(text)) return "assassination";
  if (/إطلاق نار|اطلاق نار|shooting|총격/iu.test(text)) return "shooting";
  return "armed_attack";
}

export function classifyArticle(article = {}) {
  const raw = sourceLead(article);
  const lane = String(article.collectionLane || "");
  if (!raw.trim()) return { include: false, reason: "원문 근거 없음" };
  if (NOISE_RE.test(raw)) return { include: false, reason: "스포츠·연예·영상성 기사" };

  if (lane === "oil_market") {
    if (RETAIL_FUEL_RE.test([article.title, article.description].filter(Boolean).join(" "))) return { include: false, reason: "국내 휘발유·경유 소비자가격 중심 기사" };
    if (!OIL_RE.test(raw)) return { include: false, reason: "국제 원유시장 핵심 근거 부족" };
    return { include: true, category3: "oil_economy", baseScore: 82, reason: "국제유가 변동 원인 후보" };
  }

  if (lane === "regional_context") {
    if (GAZA_RE.test(raw)) return { include: false, reason: "가자·팔레스타인·하마스 관련 중동 기사 제외" };
    if (!REGIONAL_ACTOR_RE.test(raw) || !STRATEGIC_RE.test(raw)) return { include: false, reason: "이라크 현장 안전·항공·해운·원유·공급망과 연결되는 중동 전략 신호 부족" };
    return { include: true, category3: "regional", baseScore: 80, reason: "중동 안보·물류 핵심 정세 후보" };
  }

  if (PROJECT_RE.test(raw)) {
    return { include: true, category3: "politics", baseScore: 100, reason: "비스마야·한화 직접 관련 최우선 기사" };
  }

  if (!IRAQ_RE.test(raw)) return { include: false, reason: "원문에 이라크·BNCP 직접 연계 없음" };

  const security = SECURITY_RE.test(raw);
  const politics = POLITICS_RE.test(raw);
  if (lane === "arabic_iraq_security" && !security) return { include: false, reason: "이라크 테러·치안·시위 사건 근거 부족" };
  if (lane === "arabic_iraq_politics" && !politics) return { include: false, reason: "이라크 정치·정부·의회·NIC 근거 부족" };

  if (security) return { include: true, category3: "terror_security", baseScore: 82, reason: "이라크 테러·치안·시위 후보" };
  if (politics) return { include: true, category3: "politics", baseScore: 78, reason: "이라크 정치권 동향 후보" };
  return { include: false, reason: "주간보고서 정치·치안 범위 밖 기사" };
}

function deterministicScore(article, classification) {
  let score = Number(classification.baseScore || 0);
  if (article.sourceEvidenceLevel === "fulltext") score += 3;
  if (article.sourceType === "iraq-media-direct") score += 2;
  return Math.min(100, score);
}

function parsedJson(text = "") {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

function validFactItems(parsed, article) {
  return (Array.isArray(parsed?.facts) ? parsed.facts : [])
    .map((fact) => ({ sentenceKo: clean(fact?.sentenceKo), evidenceQuote: String(fact?.evidenceQuote || "").trim() }))
    .filter((fact) => fact.sentenceKo && !hasArabic(fact.sentenceKo) && evidenceQuoteSupported(fact.evidenceQuote, article))
    .slice(0, 3);
}

function validActors(parsed, article) {
  return (Array.isArray(parsed?.actors) ? parsed.actors : [])
    .map((actor) => ({ nameKo: clean(actor?.nameKo), roleKo: clean(actor?.roleKo), evidenceQuote: String(actor?.evidenceQuote || "").trim() }))
    .filter((actor) => actor.nameKo && !hasArabic(`${actor.nameKo} ${actor.roleKo}`) && evidenceQuoteSupported(actor.evidenceQuote, article))
    .slice(0, 6);
}

function validLocation(parsed, article) {
  const nameKo = clean(parsed?.location?.nameKo);
  const evidenceQuote = String(parsed?.location?.evidenceQuote || "").trim();
  if (!nameKo) return "";
  return evidenceQuoteSupported(evidenceQuote, article) ? nameKo : "";
}

function unsupportedCountryShift(aiText = "", raw = "") {
  const checks = [
    [/이라크/iu, /العراق|عراقي|iraq|iraqi|이라크/iu],
    [/이란/iu, /إيران|ايران|iran|이란/iu],
    [/이스라엘/iu, /إسرائيل|اسرائيل|israel|이스라엘/iu],
    [/인도/iu, /الهند|india|인도/iu]
  ];
  return checks.some(([ai, source]) => ai.test(aiText) && !source.test(raw));
}

function roleSafeTitle(titleKo, facts, actors) {
  const roleTerms = ["총리", "외무장관", "장관", "의장", "대통령", "국회의원", "의원", "주지사"];
  const mentioned = roleTerms.filter((term) => titleKo.includes(term));
  if (!mentioned.length) return titleKo;
  const supported = `${facts.map((x) => x.sentenceKo).join(" ")} ${actors.map((x) => `${x.nameKo} ${x.roleKo}`).join(" ")}`;
  return mentioned.every((term) => supported.includes(term)) ? titleKo : clean(facts[0]?.sentenceKo || titleKo);
}

async function waitForSlot() {
  const now = Date.now();
  const scheduled = Math.max(now, nextRequestAt);
  nextRequestAt = scheduled + MIN_INTERVAL_MS;
  if (scheduled > now) await sleep(scheduled - now);
}

function retryDelay(attempt) { return RETRY_BASE_MS * (2 ** attempt) + Math.round(Math.random() * 500); }

async function callModel(article, extraInstruction = "") {
  const prompt = factExtractionPrompt({
    sourceLanguage: hasArabic(`${article.title || ""}\n${sourceText(article)}`) ? "Arabic" : hasKorean(`${article.title || ""}\n${sourceText(article)}`) ? "Korean" : "English",
    collectionLane: article.collectionLane || "",
    sourceEvidenceLevel: article.sourceEvidenceLevel || ""
  });
  const input = JSON.stringify({
    title: article.title,
    source: article.source,
    publishedAt: article.publishedAt,
    description: article.description,
    sourceText: sourceText(article)
  }, null, 2);

  let model = activeModel;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
    await waitForSlot();
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model,
          text: { verbosity: "low" },
          input: [
            { role: "system", content: "Translate and extract only source-grounded facts. Output valid JSON only." },
            { role: "user", content: `${prompt}\n${extraInstruction}\n\n기사 데이터:\n${input}` }
          ]
        })
      });
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) throw error;
      await sleep(retryDelay(attempt));
      continue;
    }

    if (response.ok) {
      const data = await response.json();
      return data.output_text || (data.output || []).flatMap((part) => part.content || []).map((part) => part.text || "").join("\n");
    }

    const errorText = await response.text();
    const unavailable = response.status === 404 && /model_not_found|must be verified|verified to use/i.test(errorText);
    if (unavailable && FACT_FALLBACK_MODEL && model !== FACT_FALLBACK_MODEL) {
      activeModel = FACT_FALLBACK_MODEL;
      model = activeModel;
      if (!fallbackLogged) {
        console.warn(`[facts] ${FACT_MODEL} unavailable; falling back to ${activeModel}`);
        fallbackLogged = true;
      }
      continue;
    }
    if (![408, 409, 429].includes(response.status) && response.status < 500) throw new Error(`OpenAI ${response.status}: ${errorText}`);
    if (attempt === MAX_RETRIES - 1) throw new Error(`OpenAI ${response.status}: ${errorText}`);
    await sleep(retryDelay(attempt));
  }
  throw new Error("fact extraction retry limit reached");
}

function buildArticle(article, classification, parsed, model) {
  const facts = validFactItems(parsed, article);
  if (!facts.length) throw new Error("no evidence-backed facts");
  const actors = validActors(parsed, article);
  const location = validLocation(parsed, article);
  const titleEvidenceSupported = evidenceQuoteSupported(parsed?.titleEvidenceQuote, article);
  let titleKo = clean(parsed?.translatedTitleKo);
  if (!titleKo || hasArabic(titleKo) || !titleEvidenceSupported) titleKo = clean(facts[0].sentenceKo);
  titleKo = roleSafeTitle(titleKo, facts, actors);
  const summaryKo = facts.map((fact) => fact.sentenceKo.replace(/[.。]+$/g, "")).join(". ") + ".";
  const aiCombined = `${titleKo}\n${summaryKo}\n${actors.map((x) => `${x.nameKo} ${x.roleKo}`).join("\n")}\n${location}`;
  if (unsupportedCountryShift(aiCombined, sourceText(article))) throw new Error("unsupported country shift");

  const category3 = classification.category3;
  const meta = categoryMeta(category3);
  const eventType = category3 === "terror_security" ? securityEventType(sourceLead(article)) : "none";
  return {
    ...article,
    ...meta,
    category3,
    importanceScore: deterministicScore(article, classification),
    reportUsefulness: "include",
    weeklyReportReason: classification.reason,
    titleKo,
    summaryKo,
    reportBullet: titleKo,
    reportSubBullets: [],
    reportImplication: "",
    actors: actors.map((actor) => clean(`${actor.nameKo}${actor.roleKo ? ` ${actor.roleKo}` : ""}`)),
    location,
    securityEventType: eventType,
    securityEventCount: eventType === "none" ? 0 : 1,
    sourceReliability: article.sourceEvidenceLevel === "fulltext" ? "기사 원문 전문 확인" : "RSS 제목·설명 기반",
    extractedFacts: facts,
    extractedActors: actors,
    articleStructure: parsed?.articleStructure === "multi_issue" ? "multi_issue" : "single_event",
    selected: false,
    translationFailed: false,
    aiSummaryVersion: FACT_EXTRACTION_VERSION,
    factExtractionVersion: FACT_EXTRACTION_VERSION,
    factExtractionFingerprint: fingerprint(article),
    factExtractionModel: model,
    factExtractedAt: new Date().toISOString()
  };
}

function reusable(article, classification) {
  return classification.include &&
    article.factExtractionVersion === FACT_EXTRACTION_VERSION &&
    article.factExtractionFingerprint === fingerprint(article) &&
    article.titleKo && article.summaryKo && !article.translationFailed;
}

async function extractOne(article, classification) {
  try {
    let parsed = parsedJson(await callModel(article));
    try { return buildArticle(article, classification, parsed, activeModel); }
    catch {
      parsed = parsedJson(await callModel(article, "이전 응답 중 원문에 그대로 존재하지 않는 evidenceQuote가 있었다. 모든 evidenceQuote를 기사 데이터에서 연속으로 정확히 복사해 JSON 전체를 다시 작성한다."));
      return buildArticle(article, classification, parsed, activeModel);
    }
  } catch (error) {
    console.warn(`[facts] failed: ${String(article.title || "").slice(0, 100)} - ${error.message || error}`);
    return null;
  }
}

async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      result[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const inputArticles = Array.isArray(payload.articles) ? payload.articles : [];
  const candidates = [];
  const removed = [];
  for (const article of inputArticles) {
    const classification = classifyArticle(article);
    if (!classification.include) {
      removed.push({ id: article.id || "", title: article.titleKo || article.title || "", reason: classification.reason });
      continue;
    }
    candidates.push({ article, classification });
  }

  candidates.sort((a, b) => deterministicScore(b.article, b.classification) - deterministicScore(a.article, a.classification) || new Date(b.article.publishedAt || 0) - new Date(a.article.publishedAt || 0));
  const kept = [];
  const pending = [];
  let reusedCount = 0;
  for (const item of candidates) {
    if (reusable(item.article, item.classification)) {
      kept.push(item.article);
      reusedCount += 1;
    } else {
      pending.push(item);
    }
  }

  const selected = pending.slice(0, MAX_ITEMS);
  const overflow = pending.slice(MAX_ITEMS);
  for (const item of overflow) removed.push({ id: item.article.id || "", title: item.article.titleKo || item.article.title || "", reason: "1차 사실 추출 처리 상한 초과" });

  if (!OPENAI_API_KEY && selected.length) throw new Error("OPENAI_API_KEY is required for fact extraction");
  const extracted = await mapLimit(selected, CONCURRENCY, (item) => extractOne(item.article, item.classification));
  let failedCount = 0;
  extracted.forEach((article, index) => {
    if (article) kept.push(article);
    else {
      failedCount += 1;
      const source = selected[index].article;
      removed.push({ id: source.id || "", title: source.titleKo || source.title || "", reason: "근거 인용 검증을 통과한 번역·사실 추출 실패" });
    }
  });

  kept.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0) || Number(b.importanceScore || 0) - Number(a.importanceScore || 0));
  payload.articles = kept;
  payload.count = kept.length;
  payload.model = activeModel;
  payload.requestedModel = FACT_MODEL;
  payload.counts = {
    total: kept.length,
    politics: kept.filter((x) => x.category3 === "politics").length,
    terror_security: kept.filter((x) => x.category3 === "terror_security").length,
    oil_economy: kept.filter((x) => x.category3 === "oil_economy").length,
    regional: kept.filter((x) => x.category3 === "regional").length,
    exclude: 0
  };
  payload.factExtraction = {
    version: FACT_EXTRACTION_VERSION,
    requestedModel: FACT_MODEL,
    model: activeModel,
    candidates: candidates.length,
    reused: reusedCount,
    requested: selected.length,
    extracted: extracted.filter(Boolean).length,
    failed: failedCount,
    removedBeforeAi: removed.length - overflow.length - failedCount,
    overflow: overflow.length,
    removed: removed.slice(0, 120),
    completedAt: new Date().toISOString()
  };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.count = payload.count;
    index.counts = payload.counts;
    index.model = activeModel;
    index.requestedModel = FACT_MODEL;
    index.factExtraction = {
      version: FACT_EXTRACTION_VERSION,
      reused: reusedCount,
      requested: selected.length,
      extracted: extracted.filter(Boolean).length,
      failed: failedCount,
      removedCount: removed.length
    };
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`[facts] candidates=${candidates.length}, reused=${reusedCount}, requested=${selected.length}, extracted=${extracted.filter(Boolean).length}, failed=${failedCount}, removed=${removed.length}, model=${activeModel}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
