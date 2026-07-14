#!/usr/bin/env node
/**
 * Keep the Weekly-Report collector focused on Iraq, BNCP and strategically
 * relevant Middle East developments.
 *
 * Foreign domestic crime/terror incidents (for example a UK local arrest or
 * threat case) must not be classified as Iraq's weekly terrorism situation
 * unless the title contains a direct Iraq/project or regional-strategic link.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return source.replace(search, replacement);
}

let code = await fs.readFile(TARGET, "utf8");

const functionAnchor = `function uniqueRecent(items, limit = MAX_TOTAL) {`;
const helper = `function weeklyReportTitleText(item = {}) {
  return [item.title, item.titleKo, item.query].filter(Boolean).join("\\n");
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

${functionAnchor}`;

code = replaceOnce(code, functionAnchor, helper, "weekly report scope helper");

code = replaceOnce(
  code,
  `  for (const item of items) {\n    if (isExcludedNinaArticle(item)) continue;`,
  `  for (const item of items) {\n    if (isExcludedNinaArticle(item)) continue;\n    if (!hasWeeklyReportScope(item)) continue;`,
  "pre-AI scope filter"
);

code = replaceOnce(
  code,
  `    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",`,
  `    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",\n    "영국·유럽·미국 등 제3국의 현지 범죄·테러·반이슬람 사건은 이라크 정부·국민·공관·사업 또는 중동 안보에 직접 연결되지 않으면 반드시 exclude 처리하라.",\n    "제3국의 현지 치안 사건을 '이라크 주간 테러 상황'으로 분류하지 말라.",`,
  "AI report-scope instructions"
);

await fs.writeFile(TARGET, code, "utf8");
console.log("Applied Iraq/BNCP weekly-report scope guard.");
