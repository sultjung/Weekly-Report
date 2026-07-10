#!/usr/bin/env node
/**
 * Generate an expanded collector for weekly report coverage.
 *
 * Purpose:
 * - Keep the base collector stable.
 * - Add targeted Google News RSS queries for report-critical items that are easy to miss:
 *   construction/housing policy, cabinet formation delays, ministerial confidence votes,
 *   PM visit to the US, SCF internal conflict, NIC chair dismissal, and Integrity Commission referrals.
 * - Raise scoring for those weekly-report decision-risk themes.
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
  `  '"العراق" "مكافحة الفساد"',`,
  `  '"العراق" "مكافحة الفساد"',
  '"الإطار التنسيقي" "الحقائب الوزارية"',
  '"الإطار التنسيقي" "المرشحين للوزارات"',
  '"الإطار التنسيقي" "الخلافات الداخلية"',
  '"الإطار التنسيقي" "اكتمال الكابينة"',
  '"الإطار التنسيقي" "زيارة واشنطن"',
  '"رئيس الوزراء" "زيارة واشنطن" "الكابينة الوزارية"',
  '"العراق" "الكابينة الوزارية" "زيارة واشنطن"',
  '"العراق" "التصويت على الوزراء"',
  '"مجلس النواب" "التصويت على الوزراء"',
  '"مجلس النواب" "منح الثقة" "الوزراء"',
  '"مجلس النواب" "استئناف جلساته" "الوزراء"',
  '"مجلس النواب" "رئيس الهيئة الوطنية للاستثمار" "إعفاء"',
  '"مجلس النواب" "الهيئة الوطنية للاستثمار" "إعفاء"',
  '"رئيس الهيئة الوطنية للاستثمار" "هيئة النزاهة"',
  '"الهيئة الوطنية للاستثمار" "إحالته إلى النزاهة"',
  '"الهيئة الوطنية للاستثمار" "ملفات الفساد"',
  '"Iraq" "Coordination Framework" "ministerial candidates"',
  '"Iraq" "cabinet completion" "Washington visit"',
  '"Iraq parliament" "confidence vote" "ministers"',
  '"Iraq parliament" "National Investment Commission" "dismissal"',
  '"Iraq" "National Investment Commission" "Integrity Commission"',`,
  "cabinet formation and NIC dismissal targeted queries"
);

code = replaceOnce(
  code,
  `  '"العراق" "مدن سكنية"',\n  '"العراق" "توزيع الأراضي"',`,
  `  '"العراق" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "معايير بيئية"',\n  '"وزارة الإعمار والإسكان" "التخطيط العمراني"',\n  '"وزارة الإعمار والإسكان" "مواد البناء المحلية"',\n  '"المدن السكنية" "معايير بيئية"',\n  '"المدن السكنية" "العزل الحراري"',\n  '"المدن السكنية" "المساحات الخضراء"',\n  '"المدن السكنية" "مواد البناء المحلية"',\n  '"العراق" "معايير بيئية" "مدن سكنية"',\n  '"العراق" "معايير التخطيط العمراني"',\n  '"Iraq" "Ministry of Construction and Housing" "environmental standards"',\n  '"Iraq" "new residential cities" "urban planning"',\n  '"Iraq" "housing cities" "insulation" "green spaces"',\n  '"Iraq" "local construction materials" "housing"',\n  '"العراق" "توزيع الأراضي"',`,
  "housing/construction targeted Google News queries"
);

code = replaceOnce(
  code,
  `  if (iraqContext && hasAny(text, ["مجلس الوزراء", "رئيس الوزراء", "السوداني", "مجلس النواب", "البرلمان", "انتخابات", "حكومة", "الإطار التنسيقي", "المالكي", "الصدر", "النزاهة", "فساد", "استجواب", "هيئة الاستثمار", "cabinet", "parliament", "election", "government", "corruption", "정치", "의회", "정부", "선거"])) {
    score = Math.max(score, 72); category3 = "politics"; reason = "정치권 동향 후보";
  }`,
  `  if (iraqContext && hasAny(text, ["مجلس الوزراء", "رئيس الوزراء", "السوداني", "مجلس النواب", "البرلمان", "انتخابات", "حكومة", "الإطار التنسيقي", "المالكي", "الصدر", "النزاهة", "فساد", "استجواب", "هيئة الاستثمار", "cabinet", "parliament", "election", "government", "corruption", "정치", "의회", "정부", "선거"])) {
    score = Math.max(score, 72); category3 = "politics"; reason = "정치권 동향 후보";
  }
  if (iraqContext && hasAny(text, ["الحقائب الوزارية", "المرشحين للوزارات", "مرشحي الوزارات", "المرشحون للوزارات", "الكابينة الوزارية", "اكتمال الكابينة", "استكمال الكابينة", "الخلافات الداخلية", "زيارة واشنطن", "زيارة الولايات المتحدة", "التصويت على الوزراء", "منح الثقة", "جلسة مجلس النواب", "استئناف جلساته", "إعفاء رئيس الهيئة الوطنية للاستثمار", "إقالة رئيس الهيئة الوطنية للاستثمار", "رئيس الهيئة الوطنية للاستثمار", "هيئة النزاهة", "إحالته إلى النزاهة", "ملفات الفساد", "ministerial candidates", "ministerial portfolios", "cabinet completion", "complete the cabinet", "internal disputes", "internal conflict", "washington visit", "us visit", "confidence vote", "vote of confidence", "resume session", "National Investment Commission", "NIC chair", "NIC chairman", "dismissal", "Integrity Commission", "corruption files", "장관 후보자", "장관 후보", "내각 완성", "내각 구성", "내각 지연", "총리 방미", "미국 방문", "방미 이후", "내부 갈등", "신임투표", "신임 투표", "본회의 재개", "NIC 의장 해임", "국가투자위원회 의장 해임", "청렴위원회 이관", "부패 의혹"])) {
    score = Math.max(score, 88);
    category3 = "politics";
    reason = "내각 구성·의회 표결·NIC 해임 관련 핵심 정국 후보";
  }`,
  "cabinet formation and NIC dismissal scoring boost"
);

code = replaceOnce(
  code,
  `  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {
    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";
  }`,
  `  if (iraqContext && hasAny(text, ["النفط", "أوبك", "اوبك", "الموازنة", "الكهرباء", "الاقتصاد", "سعر الصرف", "استثمار", "الإعمار", "الإسكان", "oil", "opec", "budget", "electricity", "economy", "investment", "housing", "construction", "유가", "예산", "경제", "전력", "투자", "주택", "건설"])) {
    score = Math.max(score, 68); category3 = "oil_economy"; reason = "경제/유가/투자 환경 후보";
  }
  if (iraqContext && hasAny(text, ["وزارة الإعمار والإسكان", "الاعمار والاسكان", "الإعمار والإسكان", "المدن السكنية", "مدينة سكنية", "مدن سكنية", "المدن الجديدة", "مدينة جديدة", "معايير بيئية", "المعايير البيئية", "معايير التخطيط", "التخطيط العمراني", "التخطيط الحضري", "العزل الحراري", "مواد العزل", "المساحات الخضراء", "نسبة المساحات الخضراء", "نسبة الخضراء", "مواد البناء المحلية", "المواد الإنشائية المحلية", "مواد انشائية محلية", "construction and housing ministry", "ministry of construction and housing", "new residential cities", "environmental standards", "urban planning standards", "insulation", "green space", "green spaces", "local construction materials", "건설주택부", "신규 주거도시", "주거도시", "환경기준", "환경 기준", "도시계획", "도시 계획", "단열재", "녹지", "자국 건설자재", "국산 건설자재"])) {
    score = Math.max(score, 82);
    category3 = "oil_economy";
    reason = "주거도시 개발·환경/도시계획 기준 후보";
  }`,
  "housing standards scoring boost"
);

code = replaceOnce(
  code,
  `    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  `    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "시아조정기구(SCF) 내부 갈등, 장관 후보자 미확정, 내각 완성 지연, 총리 방미 이후 전망, 의회 본회의 재개, 장관 신임투표 미실시, NIC 의장 해임안, 청렴위원회 이관 관련 기사는 정치권 동향 핵심 후보로 적극 분류하라.",
    "건설주택부의 신규 주거도시, 환경기준, 도시계획 기준, 단열재, 녹지비율, 자국 건설자재 우선 사용 관련 기사는 주간보고서 경제/투자환경 후보로 적극 분류하라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  "AI classification instruction for cabinet/NIC and housing standards"
);

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared expanded collector: ${path.relative(ROOT, OUT)}`);
