#!/usr/bin/env node
/**
 * Fix known high-value political articles whose earlier AI summaries were too shallow.
 * These corrections act as deterministic examples of the expected weekly report style.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

function reportDate(article = {}) {
  const d = new Date(article.publishedAt || article.date || 0);
  return Number.isNaN(d.getTime()) ? "7.7" : `${d.getMonth() + 1}.${d.getDate()}`;
}

function isMalikiAntiCorruptionArticle(article = {}) {
  const text = [article.url, article.title, article.titleKo, article.summaryKo, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n");
  return /964media[.]com[/]700631/i.test(text)
    || (/المالكي|Al-Maliki|말리키|Nouri Al-Maliki/i.test(text) && /فرهود|نهب|فساد|مكافحة الفساد|반부패|부패|약탈/i.test(text) && /الزيدي|Al-Zaidi|알자이디/i.test(text));
}


function isScfUsVisitAntiCorruptionArticle(article = {}) {
  const text = [article.url, article.title, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n");
  return /964media[.]com[/]700631/i.test(text)
    || (/الإطار التنسيقي/.test(text) && /زيارة واشنطن|زيارة.*الولايات المتحدة/.test(text) && /لا حماية.*المتورطين بالفساد|غطاء سياسي.*المتورطين بالفساد/.test(text));
}

function fixScfUsVisitAntiCorruptionArticle(article = {}) {
  if (!isScfUsVisitAntiCorruptionArticle(article)) return article;
  const d = reportDate(article);
  return {
    ...article,
    titleKo: "시아조정기구(SCF), Al-Zaidi 총리 방미 결과 지지 및 부패 연루자 정치적 보호 배제",
    summaryKo: "시아조정기구(SCF)는 Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 제284차 회의를 열고 최근 방미 결과와 국익 관련 합의 이행에 대한 지지를 표명. 사법기관이 부패 연루를 확인한 인물은 소속과 관계없이 정치적 보호를 제공하지 않겠다고 강조하고 정부·사법기관·청렴위원회의 부패 수사를 지원하기로 함.",
    category1: "domestic",
    category2: "politics_security",
    category3: "politics",
    importanceScore: Math.max(Number(article.importanceScore || 0), 88),
    reportUsefulness: "include",
    weeklyReportReason: "Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 SCF 지도부가 방미 결과 및 국익 관련 합의를 논의한 사실과, 소속 불문 부패 연루자에 대한 정치적 보호 배제 방침을 함께 확인할 수 있는 핵심 정치 기사.",
    reportBullet: `${d}, 시아조정기구(SCF), Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리 방미 결과 및 국익 관련 합의 이행 지지 표명`,
    reportSubBullets: [
      "Al-Zaidi 총리와 SCF 지도자들이 제284차 회의에서 방미 결과를 공동 논의하고 정부의 합의 이행을 지원하기로 함.",
      "사법기관이 부패 연루를 확인한 인물은 소속과 관계없이 정치적 보호를 제공하지 않겠다고 강조."
    ],
    reportImplication: "Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 SCF 지도부가 방미 결과를 공동 논의해 시아 정치권 지도부의 정부 합의 지지 확인.",
    actors: ["시아조정기구(SCF)", "Al-Zaidi 총리", "Al-Maliki 前 총리", "이라크 사법기관", "청렴위원회"],
    location: "Baghdad",
    knownPoliticalSummaryFixed: true,
    knownPoliticalSummaryReason: "SCF US-visit and anti-corruption article requires deterministic institution and evidence correction."
  };
}

function isUsWithdrawalIsisDisarmamentArticle(article = {}) {
  const text = [article.url, article.title, article.titleKo, article.summaryKo, article.description, article.cleanText, article.fullText].filter(Boolean).join("\n");
  return /تحذيرات من عودة داعش.*الانسحاب الأمريكي|美군 철수 임박.*IS 복귀 우려/i.test(text)
    || (/الانسحاب الأمريكي|انسحاب القوات الأمريكية|withdrawal of US forces|US withdrawal/i.test(text) && /داعش|تنظيم الدولة|ISIS|ISIL|IS 재출현|IS 복귀/i.test(text));
}

function fixUsWithdrawalIsisDisarmamentArticle(article = {}) {
  if (!isUsWithdrawalIsisDisarmamentArticle(article)) return article;
  const d = reportDate(article);
  return {
    ...article,
    titleKo: "美군 철수 임박, 안보공백에 따른 IS 재출현 및 민병대 무장 유지 우려",
    summaryKo: "이라크 내 미군 철수가 9월 30일 완료될 예정인 가운데, 철수 이후 안보공백을 틈탄 IS 재출현 우려가 제기됨. 안보공백이 발생할 경우 민병대가 IS 대응을 명분으로 무기 보유를 계속 주장할 수 있어, Al-Zaidi 총리 내각이 추진 중인 무장해제 정책의 주요 장애 요인으로 작용할 가능성이 있음. 이라크 정부의 무장해제 목표일 역시 9월 30일로 제시된 만큼, 미군 철수와 무장해제 추진이 같은 시점에 맞물리는 상황임. 미군 철수 이후 이라크군의 독자적 대테러 대응 역량과 정부의 무장 통제력이 핵심 변수로 부각됨.",
    category1: "domestic", category2: "politics_security", category3: "terror_security", importanceScore: Math.max(Number(article.importanceScore || 0), 88), reportUsefulness: "include",
    weeklyReportReason: "미군 철수에 따른 IS 재출현·안보공백 우려가 민병대의 무기 보유 명분 및 정부의 9월 30일 무장해제 목표와 충돌할 수 있다는 점에서 핵심 치안·정국 기사.",
    reportBullet: \`${d}, 美軍의 9.30 이라크 철수 완료를 앞두고 IS 재출현 및 안보공백 우려 제기. 안보공백은 민병대의 무기 보유 명분으로 활용될 수 있어, 이라크 정부의 9.30 무장해제 목표와 충돌할 가능성\`,
    reportSubBullets: ["미군 철수 이후 IS 대응 공백이 발생할 경우 민병대가 무장 유지 필요성을 주장할 수 있다는 우려 제기.", "Al-Zaidi 총리 내각이 추진 중인 무장해제 정책이 치안 불안 및 민병대 반발로 차질을 빚을 수 있다는 점이 핵심 쟁점."],
    reportImplication: "미군 철수와 무장해제 목표일이 9월 30일로 겹치면서, IS 위협을 둘러싼 안보 논리가 Al-Zaidi 총리 내각의 무장 통제 정책을 제약할 수 있는 구조 형성.", actors: ["美軍", "IS", "이라크 정부", "Al-Zaidi 총리 내각", "이라크 민병대"], location: "Baghdad", knownPoliticalSummaryFixed: true,
    knownPoliticalSummaryReason: "US withdrawal, ISIS resurgence, militia weapons rationale, and the 9/30 disarmament target require deterministic deep summary."
  };
}

function fixArticle(article = {}) {
  const withdrawalFixed = fixUsWithdrawalIsisDisarmamentArticle(article);
  if (withdrawalFixed !== article) return withdrawalFixed;
  if (!isMalikiAntiCorruptionArticle(article)) return article;
  const d = reportDate(article);
  return {
    ...article,
    titleKo: "Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 前 정부 부패 비판",
    summaryKo: "Nouri Al-Maliki 前 총리는 언론 인터뷰에서 Al-Sudani 前 총리 정부 시기 부패가 약탈 수준으로 확대되었다고 강하게 비판. 전력·항만 등 주요 부문에서 부패가 심각하게 확산되었다고 주장하는 한편, Al-Zaidi 총리의 반부패 체포·압수수색 작전을 정치 신뢰 회복을 위한 충격요법으로 평가. 다만 반부패 작전은 법적 절차와 제도적 기준 안에서 지속되어야 한다고 조건 제시.",
    category1: "domestic",
    category2: "politics_security",
    category3: "politics",
    importanceScore: Math.max(Number(article.importanceScore || 0), 86),
    reportUsefulness: "include",
    weeklyReportReason: "Al-Maliki 前 총리의 Al-Zaidi 총리 반부패 공세 공개 지지와 前 정부 부패 비판은 신임 총리의 부패척결 드라이브 및 시아 정치권 내부 역학 파악에 중요.",
    reportBullet: `${d}, Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 Al-Sudani 前 총리 정부 시기 부패 강력 비판`,
    reportSubBullets: [
      "Al-Maliki 前 총리, 전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었으며 전력·항만 등 주요 부문에서 확산되었다고 주장.",
      "Al-Zaidi 총리의 체포·압수수색 등 반부패 작전은 국민 신뢰 회복을 위한 충격요법으로 평가.",
      "다만 반부패 작전은 법적 절차와 제도적 기준, 정치적 통제 안에서 지속되어야 한다고 조건 제시."
    ],
    reportImplication: "Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석.",
    actors: ["Nouri Al-Maliki 前 총리", "Al-Zaidi 총리", "Al-Sudani 前 총리", "법치국가연합"],
    location: article.location || "Baghdad",
    knownPoliticalSummaryFixed: true,
    knownPoliticalSummaryReason: "Maliki anti-corruption interview required deeper human-style political analysis."
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
  const fixed = articles.map(fixArticle);
  const fixedCount = fixed.filter((x) => x.knownPoliticalSummaryFixed).length;

  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.knownPoliticalSummaryFixedCount = fixedCount;
  payload.knownPoliticalSummaryFixedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.knownPoliticalSummaryFixedCount = fixedCount;
    index.knownPoliticalSummaryFixedAt = payload.knownPoliticalSummaryFixedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Known political summaries fixed: ${fixedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
