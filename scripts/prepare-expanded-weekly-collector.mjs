#!/usr/bin/env node
/**
 * Generate an expanded collector for weekly report coverage.
 *
 * Purpose:
 * - Keep the base collector stable.
 * - Add targeted Google News RSS queries for report-critical items that are easy to miss:
 *   construction/housing policy, cabinet formation delays, ministerial confidence votes,
 *   PM visit to the US, SCF internal conflict, NIC chair dismissal, Integrity Commission referrals,
 *   PMF/IRGC/SDF/SNA/Gaza/Iran-US-Israel regional-security developments.
 * - Raise scoring for those weekly-report decision-risk themes.
 * - Upgrade the AI writing prompt so report bullets follow the human-edited weekly report style.
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
  '"الحشد الشعبي" "حل"',
  '"الحشد الشعبي" "نزع السلاح"',
  '"الحشد الشعبي" "السيستاني"',
  '"مقتدى الصدر" "الحشد الشعبي"',
  '"سليماني" "العراق"',
  '"Iraq" "Coordination Framework" "ministerial candidates"',
  '"Iraq" "cabinet completion" "Washington visit"',
  '"Iraq parliament" "confidence vote" "ministers"',
  '"Iraq parliament" "National Investment Commission" "dismissal"',
  '"Iraq" "National Investment Commission" "Integrity Commission"',
  '"Iraq" "Popular Mobilization Forces" "disband"',
  '"Iraq" "PMF" "Sistani"',
  '"Iraq" "Sadr" "PMF" "weapons"',`,
  "cabinet formation, NIC dismissal and PMF targeted queries"
);

code = replaceOnce(
  code,
  `  '"العراق" "مدن سكنية"',\n  '"العراق" "توزيع الأراضي"',`,
  `  '"العراق" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "مدن سكنية"',\n  '"وزارة الإعمار والإسكان" "معايير بيئية"',\n  '"وزارة الإعمار والإسكان" "التخطيط العمراني"',\n  '"وزارة الإعمار والإسكان" "مواد البناء المحلية"',\n  '"المدن السكنية" "معايير بيئية"',\n  '"المدن السكنية" "العزل الحراري"',\n  '"المدن السكنية" "المساحات الخضراء"',\n  '"المدن السكنية" "مواد البناء المحلية"',\n  '"العراق" "معايير بيئية" "مدن سكنية"',\n  '"العراق" "معايير التخطيط العمراني"',\n  '"Iraq" "Ministry of Construction and Housing" "environmental standards"',\n  '"Iraq" "new residential cities" "urban planning"',\n  '"Iraq" "housing cities" "insulation" "green spaces"',\n  '"Iraq" "local construction materials" "housing"',\n  '"العراق" "توزيع الأراضي"',`,
  "housing/construction targeted Google News queries"
);

code = replaceOnce(
  code,
  `  '"Iraq" "US bases" "Iran"'\n];`,
  `  '"Iraq" "US bases" "Iran"',
  '"إيران" "الحرس الثوري" "مضيق هرمز"',
  '"الحرس الثوري" "قواعد أمريكية"',
  '"إيران" "إسرائيل" "الولايات المتحدة" "صواريخ"',
  '"إيران" "البحرين" "الكويت" "قواعد أمريكية"',
  '"ترامب" "إيران" "مذكرة تفاهم"',
  '"سوريا" "قسد" "الجيش الوطني السوري"',
  '"قسد" "مخيمات" "داعش"',
  '"غزة" "إسرائيل" "رهائن"',
  '"حماس" "رهائن" "ترامب"',
  '"Iran" "IRGC" "Hormuz" "missile"',
  '"Iran" "US bases" "Bahrain" "Kuwait"',
  '"Trump" "Iran" "memorandum"',
  '"SDF" "SNA" "Syria" "ISIS camps"',
  '"Gaza" "hostages" "Trump" "Israel"'
];`,
  "regional conflict targeted queries"
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
  }
  if (iraqContext && hasAny(text, ["الحشد الشعبي", "سليماني", "السيستاني", "الصدر", "نزع السلاح", "حل الحشد", "PMF", "Popular Mobilization", "Soleimani", "Sistani", "disband", "disarm", "weapons", "인민동원군", "무장해제", "해체", "Soleimani", "Al-Sadr", "Al-Sistani"])) {
    score = Math.max(score, 86);
    category3 = "politics";
    reason = "PMF·친이란 무장조직·이라크 주권 관련 핵심 정국 후보";
  }`,
  "cabinet formation, NIC dismissal and PMF scoring boost"
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
  `  if (regionalIraqLink && hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"])) {
    score = Math.max(score, iraqContext ? 64 : 55); category3 = "regional"; reason = "이라크와 연결 가능한 국제정세 후보";
  }`,
  `  if (regionalIraqLink && hasAny(text, ["إيران", "اسرائيل", "إسرائيل", "سوريا", "غزة", "الحوثي", "الولايات المتحدة", "القواعد الأمريكية", "الحرس الثوري", "مضيق هرمز", "iran", "israel", "syria", "gaza", "houthi", "us bases", "hormuz"])) {
    score = Math.max(score, iraqContext ? 64 : 55); category3 = "regional"; reason = "이라크와 연결 가능한 국제정세 후보";
  }
  if (hasAny(text, ["الحرس الثوري", "مضيق هرمز", "قواعد أمريكية", "البحرين", "الكويت", "مذكرة تفاهم", "قسد", "الجيش الوطني السوري", "مخيمات داعش", "حماس", "رهائن", "IRGC", "Hormuz", "US bases", "Bahrain", "Kuwait", "memorandum", "SDF", "SNA", "ISIS camps", "Hamas", "hostages", "혁명수비대", "호르무즈", "미군기지", "바레인", "쿠웨이트", "시리아민주군", "시리아국가군", "가자", "하마스", "인질"])) {
    score = Math.max(score, 76);
    category3 = "regional";
    reason = "美·이스라엘-이란 분쟁 또는 시리아·가자 관련 국제정세 핵심 후보";
  }`,
  "regional conflict scoring boost"
);

code = replaceOnce(
  code,
  `function hasReusableAiSummary(item = {}) { return !!(item.titleKo && item.summaryKo && !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) && !item.translationFailed); }`,
  `function hasReusableAiSummary(item = {}) { return !!(item.titleKo && item.summaryKo && item.aiSummaryVersion === "weekly-report-v3" && !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) && !item.translationFailed); }`,
  "force v3 AI summary refresh"
);

code = replaceOnce(
  code,
  `    "summaryKo는 3~5줄 한국어 요약. 제목 반복 금지.",
    "reportBullet은 '- ' 없이 'M.D, 주체, 핵심행위 명사형.' 구조. 예: '7.4, 이라크 의회, NIC 의장 심문 결정.'",
    "reportSubBullets는 '* ' 없이 0~2개.",
    "reportImplication은 '☞' 없이 1문장 또는 빈 문자열.",
    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~조치로 해석', '~가능성', '~필요', '~전망' 형태를 우선한다.",
    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",
    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  `    "summaryKo는 2~4줄 한국어 요약. 제목 문장을 그대로 반복하지 말고, 핵심 사실과 의미만 압축하라.",
    "보고서 전체 문체는 사람이 작성한 정세보고 문체를 따른다. 간결한 명사형·음슴체를 사용하고 장황한 설명문을 피하라.",
    "reportBullet은 '- ' 없이 'M.D, 주체, 핵심행위/결과' 구조로 1문장만 작성하라. 예: '7.4, 시아조정기구(SCF) 소식통, 내부 갈등으로 인한 장관 후보자 미확정으로 내각 완성은 총리 방미 이후 전망'.",
    "reportBullet의 주체는 기관·인물·언론·소식통을 명확히 적어라. 예: 'Al-Zaidi 총리', '이라크 의회', '시아조정기구(SCF) 소식통', '혁명수비대(IRGC)', '美 중부사령부'.",
    "reportBullet에서는 '이라크 정치 조정 기구', '정치적 조정 기구'라고 쓰지 말고 반드시 '시아조정기구(SCF)'로 표기하라.",
    "reportBullet과 reportSubBullets에서 '자이드 정부'라고 쓰지 말고 'Al-Zaidi 총리' 또는 'Al-Zaidi 총리 내각'으로 표기하라.",
    "인명·기관명은 보고서식 표기를 사용하라: Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리, Al-Sadr, Al-Sistani, Khamenei, Soleimani, Pezeshkian 대통령, Trump 대통령, 인민동원군(PMF), 혁명수비대(IRGC), 시리아민주군(SDF), 시리아국가군(SNA).",
    "지명은 가능하면 영문식으로 표기하라: Baghdad, Teheran, Najaf, Karbala, Qom, Salah al-Din州, Baghdad州.",
    "reportSubBullets는 '* ' 없이 0~2개. reportBullet을 반복하지 말고, 배경·후속 일정·세부 수치·정책 의미를 각각 1문장으로 작성하라.",
    "reportSubBullets 예시: '인민동원군(PMF) 해체 및 시리아 내정 불간섭 등 강조', '이라크 내각 구성이 Al-Zaidi 총리의 미국 방문 이후로 미뤄짐에 따라 정치적 불확실성을 더욱 부각'.",
    "reportImplication은 '☞' 없이 0~1문장. 분석 기사, 배경설명, 조직 정의, 파급효과가 분명할 때만 작성하라. 근거가 약하면 빈 문자열로 둬라.",
    "reportImplication은 '정치적 압박 강화 가능성', '정치적 의지 강화 가능성' 같은 일반론을 금지한다. 구체적 분석 축을 써라.",
    "reportImplication 예시: '반부패 수사로 정치권 내 연정 합의가 흔들리며 내각 구성 지연 가능성 제기.', '인민동원군(PMF) : IS 격퇴를 위해 창설된 非정규군으로 친이란 무장단체들이 소속되어 있어 이란 영향력 하 운영.'",
    "美·이스라엘-이란 분쟁, 시리아 SDF-SNA 교전, 가자/하마스 인질 관련 기사는 국제사회 섹션 후보로 적극 분류하라.",
    "PMF 해체·무장해제, Al-Sadr·Al-Sistani의 PMF 관련 입장, Soleimani 추모, Khamenei의 미군 철수 촉구는 이라크 국내 정치/치안 동향 후보로 적극 분류하라.",
    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~참석', '~강조', '~전망', '~제기', '~촉구', '~체결', '~승인', '~감행', '~시사' 형태를 우선한다.",
    "한 문단 안에서 같은 사실을 두 번 반복하지 말라. reportBullet에 쓴 문장을 reportSubBullets에서 다시 풀어쓰지 말라.",
    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",
    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라.",
    "시아조정기구(SCF) 내부 갈등, 장관 후보자 미확정, 내각 완성 지연, 총리 방미 이후 전망, 의회 본회의 재개, 장관 신임투표 미실시, NIC 의장 해임안, 청렴위원회 이관 관련 기사는 정치권 동향 핵심 후보로 적극 분류하라.",
    "건설주택부의 신규 주거도시, 환경기준, 도시계획 기준, 단열재, 녹지비율, 자국 건설자재 우선 사용 관련 기사는 주간보고서 경제/투자환경 후보로 적극 분류하라.",
    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`,
  "weekly report human sample writing style prompt"
);

code = replaceOnce(
  code,
  `aiSummaryVersion: "weekly-report-v1"`,
  `aiSummaryVersion: "weekly-report-v3"`,
  "bump AI summary version"
);

await fs.writeFile(OUT, code, "utf8");
console.log(`Prepared expanded collector: ${path.relative(ROOT, OUT)}`);
