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
const VERSION = "weekly-report-writing-v3-cost-optimized";

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
    "반드시 JSON 객체만 출력하고 키는 reportBullet, reportSubBullets, reportImplication만 사용하라.",
    "reportBullet: 최종 주간보고서에 바로 넣을 수 있도록 핵심 내용을 보고서 형식으로 압축한다. 반드시 1문장일 필요는 없지만 불필요하게 길게 쓰지 않는다.",
    "reportBullet은 M.D 형식의 날짜로 시작하고 주체·장소·행동·결과를 포함한다. 기사 제목을 그대로 번역하지 않는다.",
    "이라크·비스마야·한화·NIC·치안·유가·물류와 직접 연결되는 경우에만 사업 또는 파급효과를 언급한다. 연결 근거가 없으면 일반적인 영향 가능성을 덧붙이지 않는다.",
    "기사에 없는 원인·전망·피해·정치적 의미를 추가하지 않는다. '~하였다', '~하고 있다', '주목된다', '가능성이 있다' 같은 해설형 표현을 피하고 짧고 단정적인 보고서 문체를 사용한다.",
    "reportBullet은 대체로 45~80자 내외를 유지하되, 핵심 사실을 전달하기 위해 필요한 경우 문장을 나누어 작성할 수 있다.",
    "reportSubBullets: '* ' 없이 0~2개. reportBullet에 담지 못한 구체적 사실이 있을 때만 작성하고 일반적 전망·가능성·영향은 작성하지 않는다.",
    "reportImplication: 구체적인 정치·안보·경제·BNCP 사업 영향이 근거로 확인될 때만 1문장, 아니면 빈 문자열.",
    "일반론, 과장, 추측, 기사 제목 반복, '~하였다/했다/하고 있다' 문체를 피하라.",
    "표기 기준: NIC, 청렴위원회, 시아조정기구(SCF), 인민동원군(PMF), 혁명수비대(IRGC), Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리.",
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
    reportSubBullets: arrayOf(parsed.reportSubBullets, 2),
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
