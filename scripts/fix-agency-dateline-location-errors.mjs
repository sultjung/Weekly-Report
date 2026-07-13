#!/usr/bin/env node
/**
 * Fix high-risk location mistranslations caused by Arabic agency datelines.
 *
 * Example:
 *   "بغداد / نينا / اعلن التلفزيون الايراني ... في قشم وجاسك..."
 * means the NINA story was filed from Baghdad; the explosions did NOT occur in Baghdad.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const NINA_DATELINE_RE = /^\s*(?:بغداد|baghdad)\s*[\/ـ\-–—|]+\s*(?:نينا|nina)\s*[\/ـ\-–—|]+\s*/i;
const INA_DATELINE_RE = /^\s*(?:بغداد|baghdad)\s*[\/ـ\-–—|]+\s*(?:واع|ina)\s*[\/ـ\-–—|]+\s*/i;
const ANY_AGENCY_DATELINE_RE = /^\s*(?:بغداد|baghdad|اربيل|أربيل|erbil|كركوك|kirkuk|البصرة|basra|السليمانية|sulaymaniyah)\s*[\/ـ\-–—|]+\s*(?:نينا|nina|واع|ina)\s*[\/ـ\-–—|]+\s*/i;

const IRAN_EXPLOSION_LOCATION_RE = /(قشم|جاسك|بندر عباس|سيريك|ميناب|qeshm|jask|bandar abbas|sirik|minab)/i;
const IRAN_TV_RE = /(التلفزيون الايراني|التلفزيون الإيراني|iranian tv|iran tv|이란 tv|이란 방송)/i;
const EXPLOSION_RE = /(انفجار|انفجارات|폭발|explosion|explosions)/i;

function stripAgencyDateline(value = "") {
  return String(value || "")
    .replace(ANY_AGENCY_DATELINE_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

function textOf(article = {}) {
  return [article.title, article.description, article.cleanText, article.fullText, article.titleKo, article.summaryKo, article.reportBullet, ...(article.reportSubBullets || []), article.reportImplication, article.location]
    .filter(Boolean)
    .join("\n");
}

function isIranExplosionDatelineError(article = {}) {
  const raw = textOf(article);
  const beginsWithDateline = [article.description, article.cleanText, article.fullText].some((v) => NINA_DATELINE_RE.test(String(v || "")) || INA_DATELINE_RE.test(String(v || "")));
  return beginsWithDateline && IRAN_TV_RE.test(raw) && EXPLOSION_RE.test(raw) && IRAN_EXPLOSION_LOCATION_RE.test(raw);
}

function cleanBaghdadFalseLocation(value = "") {
  return String(value || "")
    .replace(/이라크\s*Baghdad에서\s*/g, "이란 남부 지역에서 ")
    .replace(/Baghdad에서\s*/g, "이란 남부 지역에서 ")
    .replace(/바그다드에서\s*/g, "이란 남부 지역에서 ")
    .replace(/이라크\s*Baghdad/i, "이란 남부")
    .replace(/Baghdad/i, "이란 남부")
    .replace(/바그다드/g, "이란 남부")
    .replace(/이라크에서\s*여러\s*지역에서/g, "이란 남부 여러 지역에서")
    .replace(/이라크의\s*치안\s*상황/g, "이란 내 폭발 동향")
    .replace(/이라크\s*내각\s*구성\s*지연\s*및\s*의회\s*활동\s*재개와\s*관련된\s*정치적\s*동향을\s*반영하는\s*사건/g, "이란 남부 지역 폭발 관련 동향")
    .replace(/내각\s*구성\s*지연이\s*지속될\s*가능성\s*제기/g, "역내 안보 불확실성 확대 가능성 제기")
    .replace(/정치적\s*불안정성이\s*심화되며,?\s*/g, "역내 긴장 고조로 ")
    .trim();
}

function fixArticle(article = {}) {
  let fixed = { ...article };

  for (const field of ["description", "cleanText", "fullText"]) {
    if (fixed[field]) fixed[field] = stripAgencyDateline(fixed[field]);
  }

  if (!isIranExplosionDatelineError(article)) return fixed;

  const date = (() => {
    const d = new Date(article.publishedAt || article.date || 0);
    return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}.${d.getDate()}`;
  })();

  fixed = {
    ...fixed,
    titleKo: "이란 방송, 남부 여러 지역에서 연쇄 폭발 발생 보도",
    summaryKo: "이란 TV는 Qeshm, Jask, Bandar Abbas, Sirik, Minab 등 이란 남부 여러 지역에서 연쇄 폭발이 발생했다고 보도. 기사 앞의 ‘Baghdad / NINA /’는 NINA의 송고지·통신사 표기이며 폭발 발생지가 Baghdad라는 의미가 아님.",
    category1: "international",
    category2: "international",
    category3: "regional",
    importanceScore: Math.max(Number(article.importanceScore || 0), 72),
    reportUsefulness: "watch",
    weeklyReportReason: "이란 내 폭발 보도로 역내 안보 동향 확인 필요. 단, Baghdad/NINA는 송고지 표기이며 사건 장소가 아님.",
    reportBullet: `${date || "7.12"}, 이란 방송, Qeshm·Jask·Bandar Abbas 등 남부 지역 연쇄 폭발 발생 보도`,
    reportSubBullets: ["NINA의 ‘Baghdad / NINA /’ 표기는 송고지·통신사 표기이며, 폭발 발생지는 Baghdad가 아닌 이란 남부 지역."],
    reportImplication: "역내 긴장 고조 시 이라크 정세 및 현장 안전환경에 간접 영향 가능성 점검 필요",
    actors: ["이란 방송", "NINA"],
    location: "Qeshm, Jask, Bandar Abbas, Sirik, Minab",
    sourceReliability: "NINA 인용 보도 / 이란 방송 발표",
    datelineLocationCorrected: true,
    datelineCorrectionReason: "Baghdad/NINA dateline was source filing location, not incident location."
  };

  for (const field of ["summaryKo", "weeklyReportReason", "reportBullet", "reportImplication", "location"]) {
    fixed[field] = cleanBaghdadFalseLocation(fixed[field]);
  }
  fixed.reportSubBullets = (fixed.reportSubBullets || []).map(cleanBaghdadFalseLocation);
  fixed.actors = (fixed.actors || []).filter((x) => !/Baghdad|바그다드/i.test(String(x || "")));

  return fixed;
}

function recalcCounts(articles = []) {
  return {
    total: articles.length,
    politics: articles.filter((x) => x.category3 === "politics").length,
    terror_security: articles.filter((x) => x.category3 === "terror_security").length,
    oil_economy: articles.filter((x) => x.category3 === "oil_economy").length,
    regional: articles.filter((x) => x.category3 === "regional").length,
    exclude: articles.filter((x) => x.category3 === "exclude" || x.reportUsefulness === "exclude").length
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const fixed = articles.map(fixArticle);
  const fixedCount = fixed.filter((x) => x.datelineLocationCorrected).length;
  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.datelineLocationCorrectedCount = fixedCount;
  payload.datelineLocationCorrectedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2), "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.datelineLocationCorrectedCount = fixedCount;
    index.datelineLocationCorrectedAt = payload.datelineLocationCorrectedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2), "utf8");
  } catch {}

  console.log(`Agency dateline location corrections applied: ${fixedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
