#!/usr/bin/env node
/**
 * Patch the generated expanded collector with a stronger human-style analysis prompt.
 * This runs after prepare-expanded-weekly-collector.mjs and before collect-news.expanded.mjs.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceAll(src, search, replacement, label) {
  if (!src.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return src.split(search).join(replacement);
}

let code = await fs.readFile(TARGET, "utf8");

code = replaceAll(
  code,
  `item.aiSummaryVersion === "weekly-report-v3"`,
  `item.aiSummaryVersion === "weekly-report-v4"`,
  "AI cache version v4"
);

code = replaceAll(
  code,
  `aiSummaryVersion: "weekly-report-v3"`,
  `aiSummaryVersion: "weekly-report-v4"`,
  "AI summary output version v4"
);

code = replaceAll(
  code,
  `reportSubBullets: normalizeArray(parsed.reportSubBullets, 2),`,
  `reportSubBullets: normalizeArray(parsed.reportSubBullets, 3),`,
  "allow three report sub bullets"
);

code = replaceAll(
  code,
  `    "summaryKo는 2~4줄 한국어 요약. 제목 문장을 그대로 반복하지 말고, 핵심 사실과 의미만 압축하라.",
    "보고서 전체 문체는 사람이 작성한 정세보고 문체를 따른다. 간결한 명사형·음슴체를 사용하고 장황한 설명문을 피하라.",`,
  `    "summaryKo는 3~5줄 한국어 요약. 제목 문장을 그대로 반복하지 말고, 기사 본문에서 확인되는 핵심 주장·비판 대상·조건·정치적 의미를 압축하라.",
    "제목이 자극적이거나 일부 발언만 강조한 경우 제목을 따라가지 말고 본문 전체의 핵심 정치 메시지를 우선하라.",
    "정치인 인터뷰·논평·발언 기사는 반드시 다음 축을 확인하라: ① 누구를 지지/비판했는지, ② 어떤 정부·정당·기관을 겨냥했는지, ③ 구체 사례/부문/표현이 있는지, ④ 단서·조건·선 긋기가 있는지, ⑤ 이것이 정치적 방어선 또는 연정 내부 신호인지.",
    "반부패·체포·압수수색·부패 폭로 기사에서는 단순히 '반부패 필요'라고 쓰지 말고, 전 정부 비판인지, 신임 총리 지지인지, 법적 절차 요구인지, 특정 세력 견제인지 구분하라.",
    "보고서 전체 문체는 사람이 작성한 정세보고 문체를 따른다. 간결한 명사형·음슴체를 사용하고 장황한 설명문을 피하라.",`,
  "analysis-first summary instructions"
);

code = replaceAll(
  code,
  `    "reportSubBullets는 '* ' 없이 0~2개. reportBullet을 반복하지 말고, 배경·후속 일정·세부 수치·정책 의미를 각각 1문장으로 작성하라.",
    "reportSubBullets 예시: '인민동원군(PMF) 해체 및 시리아 내정 불간섭 등 강조', '이라크 내각 구성이 Al-Zaidi 총리의 미국 방문 이후로 미뤄짐에 따라 정치적 불확실성을 더욱 부각'.",`,
  `    "reportSubBullets는 '* ' 없이 1~3개. reportBullet을 반복하지 말고, 발언 배경·비판 대상·구체 사례·조건부 입장·정책 의미를 각각 1문장으로 작성하라.",
    "정치인 인터뷰/발언 기사 reportSubBullets 구성 예시: ① 전 정부 또는 경쟁 세력에 대한 비판, ② 부패·치안·내각 등 구체 쟁점, ③ 지지하되 법적 절차·제도적 통제 필요 등 단서.",
    "reportSubBullets 예시: '전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었다고 비판', '전력·항만 등 주요 부문에서 부패 확산을 지적', '반부패 작전 지속 필요성을 인정하면서도 법적 절차와 제도적 기준 내 진행 필요성 언급'.",`,
  "richer sub bullet instructions"
);

code = replaceAll(
  code,
  `    "reportImplication은 '정치적 압박 강화 가능성', '정치적 의지 강화 가능성' 같은 일반론을 금지한다. 구체적 분석 축을 써라.",
    "reportImplication 예시: '반부패 수사로 정치권 내 연정 합의가 흔들리며 내각 구성 지연 가능성 제기.', '인민동원군(PMF) : IS 격퇴를 위해 창설된 非정규군으로 친이란 무장단체들이 소속되어 있어 이란 영향력 하 운영.'",`,
  `    "reportImplication은 '정치적 압박 강화 가능성', '정치적 의지 강화 가능성' 같은 일반론을 금지한다. 구체적 분석 축을 써라.",
    "정치인 발언의 시사점은 '공개 지지', '조건부 지지', '정치적 방어선', '연정 내부 견제', '전 정부 책임론', '수사 확대 가능성 차단' 중 실제 근거가 있는 축으로 작성하라.",
    "reportImplication 예시: 'Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석.', '인민동원군(PMF) : IS 격퇴를 위해 창설된 非정규군으로 친이란 무장단체들이 소속되어 있어 이란 영향력 하 운영.'",`,
  "specific implication instructions"
);

code = replaceAll(
  code,
  `    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~참석', '~강조', '~전망', '~제기', '~촉구', '~체결', '~승인', '~감행', '~시사' 형태를 우선한다.",`,
  `    "보고서 문체는 '~하였다/했다/하고 있다'를 피하고 '~참석', '~강조', '~비판', '~지지', '~조건 제시', '~전망', '~제기', '~촉구', '~체결', '~승인', '~감행', '~시사' 형태를 우선한다.",
    "기사 제목이 '전투탱크', '공격하고 싶어했다'처럼 부분 발언을 강조하더라도, 그것이 본문의 핵심이 아니면 reportBullet의 중심으로 삼지 말고 보조 설명으로 낮춰라.",`,
  "style verbs and sensational headline guard"
);

await fs.writeFile(TARGET, code, "utf8");
console.log("Applied human analysis prompt v4 to collect-news.expanded.mjs");
