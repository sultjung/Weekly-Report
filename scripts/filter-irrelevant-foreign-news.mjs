#!/usr/bin/env node
/**
 * Filter foreign-only articles from Iraqi media sources.
 *
 * Iraqi outlets also publish world news. Those articles should not become Iraq
 * weekly-report candidates unless the article itself has a direct Iraq/BNCP
 * link or is a strategically relevant Middle East development.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function textOf(article = {}) {
  return [
    article.url,
    article.source,
    article.title,
    article.titleKo,
    article.description,
    article.summaryKo,
    article.weeklyReportReason,
    article.reportBullet,
    ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
    article.reportImplication,
    ...(Array.isArray(article.actors) ? article.actors : []),
    article.location
  ].filter(Boolean).join(" ").toLowerCase();
}

function sourceTextOf(article = {}) {
  return [
    article.url,
    article.source,
    article.title,
    article.description,
    article.cleanText,
    article.fullText
  ].filter(Boolean).join(" ").toLowerCase();
}

const IRAQ_LINK_RE = /العراق|عراقي|العراقية|بغداد|البصرة|الموصل|نينوى|أربيل|اربيل|كركوك|الأنبار|الانبار|ديالى|كربلاء|النجف|السليمانية|إقليم كردستان|اقليم كردستان|كردستان العراق|الحكومة العراقية|البرلمان العراقي|رئيس الوزراء العراقي|العلاقات العراقية|بسماية|بسمايه|هانوا|الهيئة الوطنية للاستثمار|iraq|iraqi|baghdad|basra|mosul|nineveh|erbil|kirkuk|anbar|diyala|karbala|najaf|sulaymaniyah|iraqi kurdistan|kurdistan region of iraq|krg|iraq border|iraqi border|bismayah|bismaya|bncp|hanwha|national investment commission|이라크|바그다드|바스라|모술|니나와|아르빌|에르빌|키르쿠크|안바르|디얄라|카르발라|나자프|이라크 쿠르드|쿠르드 자치정부|이라크 국경|비스마야|한화|국가투자위원회/iu;

const STRATEGIC_MIDDLE_EAST_RE = /إيران|ايران|إسرائيل|اسرائيل|فلسطين|غزة|الضفة الغربية|سوريا|الحوثي|البحر الأحمر|مضيق هرمز|الحرس الثوري|القواعد الأمريكية|لبنان|حزب الله|حماس|iran|israel|palestine|gaza|west bank|syria|houthi|red sea|hormuz|irgc|us bases|lebanon|hezbollah|hamas|이란|이스라엘|팔레스타인|가자|서안|시리아|후티|홍해|호르무즈|혁명수비대|미군기지|레바논|헤즈볼라|하마스/iu;

const FOREIGN_LOCAL_PLACE_RE = /بريطانيا|المملكة المتحدة|إنجلترا|انجلترا|لندن|سوفولك|مانشستر|فرنسا|باريس|ألمانيا|المانيا|برلين|إيطاليا|ايطاليا|إسبانيا|اسبانيا|السويد|النرويج|هولندا|بلجيكا|الولايات المتحدة|نيويورك|كندا|أستراليا|استراليا|united kingdom|britain|england|london|suffolk|manchester|france|paris|germany|berlin|italy|spain|sweden|norway|netherlands|belgium|united states|new york|canada|australia|영국|런던|서퍽|맨체스터|프랑스|파리|독일|베를린|이탈리아|스페인|스웨덴|노르웨이|네덜란드|벨기에|미국|뉴욕|캐나다|호주/iu;

const LOCAL_CRIME_TERROR_RE = /إرهاب|ارهاب|تهديد|اعتقال|إلقاء القبض|القاء القبض|هجوم|طعن|إطلاق نار|اطلاق نار|تفجير|فعالية إسلامية|فعالية اسلامية|مسجد|terror|threat|arrest|detained|attack|stabbing|shooting|bomb|islamic event|mosque|테러|위협|체포|구금|공격|흉기|총격|폭발|이슬람 행사|모스크/iu;

const FIDAN_RE = /\bفيدان\b|هاكان\s+فيدان|hakan\s+fidan|turkish foreign minister|foreign minister of turkey|turkey'?s foreign minister|터키\s*외무장관|하칸\s*피단|피단|fidan/i;
const TURKEY_ONLY_RE = /تركيا|التركية|أنقرة|انقرة|أردوغان|اردوغان|وزارة الخارجية التركية|تركيا وسوريا|تركيا وإسرائيل|turkey|turkish|ankara|erdogan|튀르키예|터키|앙카라|에르도안/i;

function isFidanOnlyForeign(article = {}) {
  const text = textOf(article);
  if (!FIDAN_RE.test(text)) return false;
  if (IRAQ_LINK_RE.test(text)) return false;
  return true;
}

function isForeignLocalSecurityWithoutIraq(article = {}) {
  const raw = sourceTextOf(article);
  if (IRAQ_LINK_RE.test(raw) || STRATEGIC_MIDDLE_EAST_RE.test(raw)) return false;
  return FOREIGN_LOCAL_PLACE_RE.test(raw) && LOCAL_CRIME_TERROR_RE.test(raw);
}

function isForeignOnlyWithoutIraq(article = {}) {
  const text = textOf(article);
  if (IRAQ_LINK_RE.test(text)) return false;

  if (FIDAN_RE.test(text) || (TURKEY_ONLY_RE.test(text) && /ninanews\.com|nina/i.test(text))) return true;
  return false;
}

function markExcluded(article, reason) {
  return {
    ...article,
    selected: false,
    category3: "exclude",
    reportUsefulness: "exclude",
    weeklyReportReason: reason,
    irrelevantForeignFiltered: true
  };
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
  let filteredCount = 0;

  const cleaned = articles.map((article) => {
    if (isForeignLocalSecurityWithoutIraq(article)) {
      filteredCount += 1;
      return markExcluded(article, "영국·유럽·미국 등 제3국의 현지 치안/테러 사건으로 이라크·BNCP 또는 중동 전략정세와 직접 연관성이 없어 제외");
    }
    if (isFidanOnlyForeign(article)) {
      filteredCount += 1;
      return markExcluded(article, "Fidan/터키 외교 기사이나 이라크 직접 연관성이 없어 보고서 후보에서 제외");
    }
    if (isForeignOnlyWithoutIraq(article)) {
      filteredCount += 1;
      return markExcluded(article, "이라크 언론사 게재 기사이나 기사 내용상 이라크 직접 연관성이 없어 제외");
    }
    return article;
  });

  payload.articles = cleaned;
  payload.counts = recalcCounts(cleaned);
  payload.irrelevantForeignFilteredCount = filteredCount;
  payload.irrelevantForeignFilteredAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.irrelevantForeignFilteredCount = filteredCount;
    index.irrelevantForeignFilteredAt = payload.irrelevantForeignFilteredAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Filtered irrelevant foreign-only candidates: ${filteredCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
