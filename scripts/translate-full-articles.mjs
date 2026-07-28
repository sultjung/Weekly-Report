#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const API_KEY = process.env.OPENAI_API_KEY || "";
const MODEL = process.env.OPENAI_FULL_TRANSLATION_MODEL || "gpt-5.4-mini";
const FALLBACK_MODEL = process.env.OPENAI_FULL_TRANSLATION_FALLBACK_MODEL || "gpt-5.4";
const MAX_ITEMS = Number(process.env.FULL_TRANSLATION_MAX_ITEMS || 180);
const CONCURRENCY = Number(process.env.FULL_TRANSLATION_CONCURRENCY || 3);
const MAX_SOURCE_CHARS = Number(process.env.FULL_TRANSLATION_MAX_SOURCE_CHARS || 14000);
const VERSION = "weekly-report-full-translation-v1";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clean = (value = "") => String(value || "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
const isDomestic = (article = {}) => article.domesticMedia === true || article.queryGroup === "korean_domestic_media" || article.collectionLane === "korean_domestic_media" || article.category3 === "domestic_media";
const hasKorean = (value = "") => /[가-힣]/.test(String(value || ""));
function sourceBody(article = {}) {
  return clean(article.fullText || article.cleanText || article.articleText || article.description || "").slice(0, MAX_SOURCE_CHARS);
}
function fingerprint(article = {}) {
  return createHash("sha256").update([article.title, sourceBody(article), article.publishedAt].filter(Boolean).join("\n")).digest("base64url").slice(0, 24);
}
function parseJson(text = "") {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(raw);
}
async function callModel(article, model) {
  const body = sourceBody(article);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model,
      text: { verbosity: "low" },
      input: [
        { role: "system", content: "Translate news faithfully into Korean. Do not summarize, omit, interpret, or add facts. Output JSON only." },
        { role: "user", content: `다음 기사의 제목과 제공된 본문 전체를 한국어로 충실하게 번역한다.\n- 요약하지 않는다.\n- 문단 구분을 유지한다.\n- 광고·메뉴·저작권 문구는 제외한다.\n- 원문에 없는 해석이나 전망을 추가하지 않는다.\n- 본문이 짧으면 제공된 범위만 번역한다.\n\n출력 JSON:\n{"translatedTitleKo":"번역 제목","translatedBodyKo":"전체 번역 본문"}\n\n제목: ${article.title || ""}\n본문:\n${body}` }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const output = data.output_text || (data.output || []).flatMap((part) => part.content || []).map((part) => part.text || "").join("\n");
  return parseJson(output);
}
async function translateOne(article) {
  const body = sourceBody(article);
  if (!body) return { ...article, fullTranslationUnavailable: true };
  if (hasKorean(`${article.title || ""}\n${body}`)) {
    return {
      ...article,
      translatedTitle: clean(article.titleKo || article.title),
      translatedBody: body,
      fullTranslation: body,
      translationPreview: body.slice(0, 420),
      fullTranslationVersion: VERSION,
      fullTranslationFingerprint: fingerprint(article),
      fullTranslationModel: "source-korean"
    };
  }
  let parsed;
  let usedModel = MODEL;
  try {
    parsed = await callModel(article, MODEL);
  } catch (error) {
    if (!FALLBACK_MODEL || FALLBACK_MODEL === MODEL) throw error;
    await sleep(800);
    usedModel = FALLBACK_MODEL;
    parsed = await callModel(article, FALLBACK_MODEL);
  }
  const translatedTitle = clean(parsed.translatedTitleKo);
  const translatedBody = clean(parsed.translatedBodyKo);
  if (!translatedTitle || translatedBody.length < 40) throw new Error("translated body too short");
  return {
    ...article,
    translatedTitle,
    titleKo: translatedTitle,
    translatedBody,
    fullTranslation: translatedBody,
    translationPreview: translatedBody.slice(0, 420),
    fullTranslationVersion: VERSION,
    fullTranslationFingerprint: fingerprint(article),
    fullTranslationModel: usedModel,
    fullTranslatedAt: new Date().toISOString(),
    translationFailed: false
  };
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try { out[index] = await fn(items[index]); }
      catch (error) {
        console.warn(`[full-translation] failed: ${String(items[index].title || "").slice(0, 90)} - ${error.message || error}`);
        out[index] = items[index];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
const articles = Array.isArray(payload.articles) ? payload.articles : [];
const targets = articles.filter((article) => !isDomestic(article));
const targetSet = new Set(targets.slice(0, MAX_ITEMS));
if (!API_KEY && targetSet.size) throw new Error("OPENAI_API_KEY is required for full article translation");
const translated = await mapLimit(articles, CONCURRENCY, async (article) => {
  if (!targetSet.has(article)) return article;
  const fp = fingerprint(article);
  if (article.fullTranslationVersion === VERSION && article.fullTranslationFingerprint === fp && String(article.translatedBody || "").length >= 40) return article;
  return translateOne(article);
});
payload.articles = translated;
payload.fullTranslation = { version: VERSION, processed: targetSet.size, generatedAt: new Date().toISOString(), model: MODEL };
await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`[full-translation] processed=${targetSet.size}, articles=${articles.length}`);
