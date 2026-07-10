#!/usr/bin/env node
/**
 * Generate an expanded collector for weekly report coverage.
 *
 * Purpose:
 * - Keep the base collector stable.
 * - Add targeted Google News RSS queries for construction/housing policy items
 *   that are important in human weekly reports but may not include general Iraq keywords.
 * - Raise scoring for Ministry of Construction/Housing, residential cities,
 *   environmental standards, insulation, green space, and local construction-material policy.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const SRC = path.join(ROOT, "scripts", "collect-news.mjs");
const OUT = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceOnce(src, search, replacement, label) {
  if (!src.includes(search)) {
    throw new Error(`Patch anchor not found: ${label}`);
  }
  return src.replace(search, replacement);
}

let code = await fs.readFile(SRC, "utf8");

code = replaceOnce(
  code,
  `  '"العراق" "مدن سكنية"',\n  '"العراق" "توزيع الأراضي"',`,
  `  '"العراق" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "معايير بيئية"',\n  '"وزارة الإعمار والإسكان" "التخطيط العمراني"',\n  '"وزارة الإعمار والإسكان" "مواد البناء المحلية"',\n  '"المدن السكنية" "معايير بيئية"',\n  '"المدن السكنية" "العزل الحراري"',\n  '"المدن السكنية" "المساحات الخضراء"',\n  '"المدن السكنية" "مواد البناء المحلية"',\n  '"العراق" "معايير بيئية" "مدن سكنية"',\n  '"العراق" "معايير التخطيط العمراني"',\n  '"Iraq" "Ministry of Construction and Housing" "environmental standards"',\n  '"Iraq" "new residential cities" "urban planning"',\n  '"Iraq" "housing cities" "insulation" "green spaces"',\n  '"Iraq" "local construction materials" "housing"',\n  '"العراق" "توزيع الأراضي"',`,
  "housing/construction targeted Google News queries"
);

code = replaceOnce(
  code,
  `  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {\n    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";\n  }`,
  `  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {\n    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";\n  }\n  if (iraqContext && hasAny(text, ["وزارة الإعمار والإسكان", "الاعمار والاسكان", "الإعمار والإسكان", "المدن السكنية", "مدينة سكنية", "مدن سكنية", "المدن الجديدة", "مدينة جديدة", "معايير بيئية", "المعايير البيئية", "معايير التخطيط", "التخطيط العمراني", "التخطيط الحضري", "العزل الحراري", "مواد العزل", "المساحات الخضراء", "نسبة المساحات الخضراء", "نسبة الخضراء", "مواد البناء المحلية", "المواد الإنشائية المحلية", "مواد انشائية محلية", "construction and housing ministry", "ministry of construction and housing", "new residential cities", "environmental standards", "urban planning standards", "insulation", "green space", "green spaces", "local construction materials", "건설주택부", "신규 주거도시", "주거도시", "환경기준", "환경 기준", "도시계획", "도시 계획", "단열재", "녹지", "자국 건설자재", "국산 건설자재"])) {\n    score = Math.max(score, 82);\n    category3 = "oil_economy";\n    reason = "주거도시 개발·환경/도시계획 기준 후보";\n  }`,
  "housing standards scoring boost"
);

code = replaceOnce(
  code,
  `    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",\n    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  `    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",\n    "건설주택부의 신규 주거도시, 환경기준, 도시계획 기준, 단열재, 녹지비율, 자국 건설자재 우선 사용 관련 기사는 주간보고서 경제/투자환경 후보로 적극 분류하라.",\n    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  "AI classification instruction for housing standards"
);

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared expanded collector: ${path.relative(ROOT, OUT)}`);
