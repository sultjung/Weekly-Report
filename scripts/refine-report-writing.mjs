#!/usr/bin/env node
/**
 * Refine report-ready writing for high-value Iraq weekly-report candidates.
 * General translation/classification is handled upstream by a balanced model;
 * only report bullets and implications are rewritten by the flagship model.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const REPORT_MODEL = process.env.OPENAI_REPORT_MODEL || "gpt-5.4-mini";
const REASONING_EFFORT = process.env.OPENAI_REPORT_REASONING || "medium";
const MIN_SCORE = Number(process.env.REPORT_REFINEMENT_MIN_SCORE || 70);
const MAX_ITEMS = Number(process.env.MAX_REPORT_REFINEMENT_ITEMS || 20);
const CONCURRENCY = Number(process.env.REPORT_REFINEMENT_CONCURRENCY || 2);
const VERSION = "weekly-report-writing-v6-security-operations";

function clean(value = "") {
  return String(value || "").replace(/^[-*·•\s]+/, "").replace(/^☞\s*/, "").replace(/\s+/g, " ").trim();
}
function arrayOf(value, limit = 2) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean).slice(0, limit);
  return [];
}
function parseJsonObject(text = "") {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}
function evidence(item = {}) {
  return String(item.cleanText || item.fullText || item.description || item.summaryKo || "").slice(0, 14000);
}
function articleKey(item = {}) {
  const rawUrl = String(item.url || "").trim();
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      url.hash = "";
      for (const key of [...url.searchParams.keys()]) {
        if (/^(utm_|fbclid|gclid|mc_)/i.test(key)) url.searchParams.delete(key);
      }
      return `url:${url.toString().replace(/\/$/, "")}`;
    } catch {
      return `url:${rawUrl.replace(/[?#].*$/, "").replace(/\/$/, "")}`;
    }
  }
  return `id:${String(item.id || "")}`;
}
function eligible(item = {}) {
  if (item.reportUsefulness !== "include" || item.category3 === "exclude") return false;
  if (Number(item.importanceScore || 0) < MIN_SCORE) return false;
  if (!evidence(item).trim()) return false;
  return item.reportWritingVersion !== VERSION;
}
async function callFlagship(item) {
  const prompt = [
    "당신은 이라크 주간 종합상황보고서의 최종 편집자다.",
    "제공된 기사 근거와 기존 분류를 바꾸지 말고 실제 보고서에 삽입할 문장만 다듬어라.",
    "외부 지식으로 사실·인과관계·전망을 추가하지 말라.",
    "기관 주체는 기사 본문 첫 문단과 성명 주체를 기준으로 확정하라. 'الإطار التنسيقي'는 이라크 시아조정기구(SCF)이며 이란 최고 의회·이란 의회·이라크 의회가 아니다. 'مجلس النواب'만 이라크 의회, 'مجلس الوزراء'만 국무회의/내각회의를 뜻한다.",
    "'الإطار التنسيقي ... لا حماية للمتورطين بالفساد' 기사라면 시아조정기구(SCF)가 발표 주체다. Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 SCF 지도자들이 방미 결과 및 국익 관련 합의 이행을 지지한 사실, 그리고 사법기관 확인 부패 연루자에 대한 소속 불문 정치적 보호 배제 방침을 반영하라.",
    "원문에 없는 이란·이란 최고 의회·이란 의회·최고지도자를 삽입하지 말라. 근거 없는 신뢰 회복·정치적 책임성 강화·영향 가능성 문장은 삭제하라.",
    "수사·부패 의혹 기사는 법적 단계를 엄격히 구분하라. 언론 보도·소식통 주장·체포영장 발부설·압수수색·압수물 발견·당사자 부인·검찰 또는 법원의 공식 확인을 같은 사실로 쓰지 말고, 원문에 있는 단계만 '보도', '주장', '설', '확인', '부인'으로 정확히 표기하라. 공식 발표·법원 문서가 없으면 체포·유죄·부패 연루를 단정하지 말라.",
    "정치권 영향은 기사 근거가 있을 때만 작성하라. 여당·연정·정당·정치연합의 반응, 보호·비호 여부, 회의·성명 또는 내부 갈등이 원문에 제시되지 않았다면 '혼란', '압력 증가', '불안정성 증대' 같은 일반적 해석은 쓰지 말라.",
    "이라크 인물은 특별히 정한 예외를 제외하고 영문식 '이름 + Al-가문명'으로 간략 표기하고, 직책·전직 여부를 뒤에 붙인다. 한국어 음역·부친명·조부명을 섞지 말라. 예: Ahmed Al-Asadi 前 MOLSA 장관, Al-Zaidi 총리. 이라크 부처·주요 정부기관은 보고서에서 통용되는 영문 약어로 통일한다.",
    "치안·테러·무기·드론 제조 관련 기사에서는 치안기관의 공식 작전·압수수색 발표인지, 언론 또는 소식통의 주장인지 먼저 구분하라. 공식 작전 기사라면 발표 기관, 작전 대상, 체포·압수 결과, 수사 단계만 사실대로 정리한다. '음모', '테러조직', '무장세력 연계' 같은 법적·정치적 평가는 원문 또는 공식 발표가 명시한 경우에만 사용한다.",
    "불법 드론 제조시설 적발 기사에서는 NSS를 '국가안보국(NSS)'으로 통일한다. reportBullet은 'M.D, 국가안보국(NSS), Baghdad 내 불법 드론 제조시설 적발' 형식을 우선하고, reportSubBullets에는 용의자·압수 규모와 최종 조립·운용 배치 전 적발 및 연계·조달망 확대 수사 사실을 각각 정리한다. 지역 무장세력 연계는 수사 중인 가능성으로만 표현하고 사실로 단정하지 않는다.",
    "기사가 여러 결정·지시·사업·현안을 함께 다룬 종합 회의·공식 발표라면 특정 세부 안건 하나로 축소하지 말라. reportBullet은 'M.D, 회의명/기관명 주요 의결 사항'으로 쓰고, reportSubBullets에 중요한 결정 3~5개를 각각 한 줄씩 정리하라. 이때 개별 안건 중심 분류나 일반적 전망은 금지한다.",
    "반드시 JSON 객체만 출력하고 키는 reportBullet, reportSubBullets, reportImplication만 사용하라.",
    "reportBullet: 최종 주간보고서에 바로 넣을 수 있도록 핵심 내용을 보고서 형식으로 압축한다. 반드시 1문장일 필요는 없지만 불필요하게 길게 쓰지 않는다.",
    "reportBullet은 M.D 형식의 날짜로 시작하고 주체·장소·행동·결과를 포함한다. 기사 제목을 그대로 번역하지 않는다.",
    "이라크·비스마야·한화·NIC·치안·유가·물류와 직접 연결되는 경우에만 사업 또는 파급효과를 언급한다. 연결 근거가 없으면 일반적인 영향 가능성을 덧붙이지 않는다.",
    "기사에 없는 원인·전망·피해·정치적 의미를 추가하지 않는다. '~하였다', '~하고 있다', '주목된다', '가능성이 있다' 같은 해설형 표현을 피하고 짧고 단정적인 보고서 문체를 사용한다.",
    "reportBullet은 대체로 45~80자 내외를 유지하되, 핵심 사실을 전달하기 위해 필요한 경우 문장을 나누어 작성할 수 있다.",
    "reportSubBullets: '* ' 없이 일반 기사는 0~2개, 종합 회의·공식 발표 기사는 3~5개. reportBullet에 담지 못한 구체적 사실만 작성하고 일반적 전망·가능성·영향은 작성하지 않는다.",
    "reportImplication: 구체적인 정치·안보·경제·BNCP 사업 영향이 근거로 확인될 때만 1문장, 아니면 빈 문자열.",
    "일반론, 과장, 추측, 기사 제목 반복, '~하였다/했다/하고 있다' 문체를 피하라.",
    "표기 기준: NIC, 청렴위원회, 시아조정기구(SCF), 인민동원군(PMF), 혁명수비대(IRGC), Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리.",
    "미군 철수와 IS 재출현·안보공백을 다루는 중요 안보 기사는 철수 예정일과 정부 무장해제 목표일을 원문에서 확인해 명시하고, 안보공백이 민병대의 무기 보유 명분으로 활용될 수 있어 무장해제 추진과 충돌한다는 핵심 연결관계를 빠뜨리지 말라. 기사에 없는 날짜·인과관계는 추가하지 말라.",
    "이 유형은 reportBullet을 2~3문장으로 확장할 수 있으며, reportSubBullets에는 IS 재출현 우려·민병대 무장 유지 명분·정부 정책 차질의 구체적 근거를 우선 배치하라.",
    "",
    JSON.stringify({
      publishedAt: item.publishedAt,
      source: item.source,
      title: item.title,
      titleKo: item.titleKo,
      summaryKo: item.summaryKo,
      category3: item.category3,
      importanceScore: item.importanceScore,
      weeklyReportReason: item.weeklyReportReason,
      articleEvidence: evidence(item)
    }, null, 2)
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${OPENAI_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: REPORT_MODEL,
      reasoning: { effort: REASONING_EFFORT },
      text: { verbosity: "low" },
      input: [
        { role: "system", content: "Write evidence-grounded Korean executive situation-report bullets. Output valid JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenAI ${response.status}: ${await response.text()}`);
  const data = await response.json();
  const output = data.output_text || (data.output || []).flatMap((part) => part.content || []).map((part) => part.text || "").join("\n");
  const parsed = parseJsonObject(output);
  if (!parsed || !clean(parsed.reportBullet)) throw new Error("invalid flagship report JSON");
  return {
    ...item,
    reportBullet: clean(parsed.reportBullet),
    reportSubBullets: arrayOf(parsed.reportSubBullets, 5),
    reportImplication: clean(parsed.reportImplication),
    reportWritingModel: REPORT_MODEL,
    reportWritingReasoning: REASONING_EFFORT,
    reportWritingVersion: VERSION,
    reportWritingRefinedAt: new Date().toISOString()
  };
}
async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      try { result[current] = await fn(items[current]); }
      catch (error) {
        console.warn(`[report-refine] failed: ${items[current].titleKo || items[current].title} - ${error.message || error}`);
        result[current] = items[current];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return result;
}
async function main() {
  if (!OPENAI_API_KEY) {
    console.log("[report-refine] skipped: OPENAI_API_KEY missing");
    return;
  }
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const candidates = (payload.articles || [])
    .filter(eligible)
    .sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0))
    .slice(0, MAX_ITEMS);
  if (!candidates.length) {
    console.log("[report-refine] no new high-value candidates");
    return;
  }
  const refined = await mapLimit(candidates, CONCURRENCY, callFlagship);
  const byKey = new Map(refined.map((item) => [articleKey(item), item]));
  payload.articles = (payload.articles || []).map((item) => byKey.get(articleKey(item)) || item);
  payload.reportWriting = {
    model: REPORT_MODEL,
    reasoning: REASONING_EFFORT,
    minScore: MIN_SCORE,
    maxItems: MAX_ITEMS,
    refined: refined.filter((item) => item.reportWritingVersion === VERSION).length,
    version: VERSION
  };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`[report-refine] candidates=${candidates.length}, refined=${payload.reportWriting.refined}, model=${REPORT_MODEL}`);
}
main().catch((error) => { console.error(error); process.exit(1); });
