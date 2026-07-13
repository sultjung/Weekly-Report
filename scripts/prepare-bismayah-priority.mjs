#!/usr/bin/env node
/**
 * Add Bismayah/BNCP-priority queries and scoring to the generated weekly collector.
 * This runs after prepare-expanded-weekly-collector.mjs.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return source.replace(search, replacement);
}

let code = await fs.readFile(TARGET, "utf8");

code = replaceOnce(
  code,
  `const GOOGLE_NEWS_QUERIES = [`,
  `const GOOGLE_NEWS_QUERIES = [
  // Bismayah / BNCP — highest-priority business coverage
  '"بسماية"',
  '"بسمايه"',
  '"مشروع بسماية"',
  '"مدينة بسماية"',
  '"مدينة بسماية الجديدة"',
  '"مجمع بسماية"',
  '"الهيئة الوطنية للاستثمار" "بسماية"',
  '"مشروع سكني في العراق"',
  '"مدينة سكنية في العراق"',
  '"الهيئة الوطنية للاستثمار في العراق"',
  '"حيدر مكية"',
  '"عادل الياسري"',
  '"شركة هانوا"',
  '"هانوا" "العراق"',
  '"شركة كورية" "بسماية"',
  '"شركة كورية" "مشروع سكني" "العراق"',
  '"Hanwha" "Iraq"',
  '"Hanwha" "Bismayah"',
  '"Bismayah"',`,
  "Bismayah priority Google News queries"
);

code = replaceOnce(
  code,
  `  const regionalIraqLink = hasAny(text, [`,
  `  const bismayahDirect = hasAny(text, ["بسماية", "بسمايه", "مشروع بسماية", "مدينة بسماية", "مدينة بسماية الجديدة", "مجمع بسماية", "bismayah", "비스마야"]);
  const bismayahStakeholder = hasAny(text, ["حيدر مكية", "حيدر مكيه", "عادل الياسري", "شركة هانوا", "هانوا", "hanwha"]);
  const bismayahInstitutional = hasAny(text, ["الهيئة الوطنية للاستثمار", "هيئة الاستثمار", "مشروع سكني في العراق", "مدينة سكنية في العراق", "شركة كورية"]);
  const regionalIraqLink = hasAny(text, [`,
  "Bismayah relevance flags"
);

code = replaceOnce(
  code,
  `  if (!iraqContext && !regionalIraqLink) return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "이라크 맥락 부족" };`,
  `  if (!iraqContext && !regionalIraqLink && !bismayahDirect && !bismayahStakeholder) return { score: 0, category3: "exclude", reportUsefulness: "exclude", reason: "이라크 맥락 부족" };

  if (bismayahDirect) {
    return { score: 100, category3: "oil_economy", reportUsefulness: "include", reason: "비스마야 사업 직접 관련 최우선 기사" };
  }
  if (bismayahStakeholder && (iraqContext || bismayahInstitutional)) {
    return { score: 96, category3: "oil_economy", reportUsefulness: "include", reason: "비스마야·한화·핵심 관계자 관련 최우선 기사" };
  }
  if (iraqContext && bismayahInstitutional) {
    return { score: 90, category3: "oil_economy", reportUsefulness: "include", reason: "NIC·이라크 주택사업 관련 주요 사업환경 기사" };
  }`,
  "Bismayah priority scoring"
);

code = replaceOnce(
  code,
  `    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",`,
  `    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",
    "비스마야·BNCP·한화·NIC·하이더 마키야·아델 알야시리 관련 보도는 사업 핵심 뉴스로 보고 최우선(include, 높은 중요도) 처리하라.",`,
  "AI Bismayah priority instruction"
);

await fs.writeFile(TARGET, code, "utf8");
console.log("Applied Bismayah/BNCP priority queries and scoring.");
