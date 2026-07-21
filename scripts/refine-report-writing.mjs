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
const REPORT_MODEL = process.env.OPENAI_REPORT_MODEL || "gpt-5.6-terra";
const REASONING_EFFORT = process.env.OPENAI_REPORT_REASONING || "medium";
const MIN_SCORE = Number(process.env.REPORT_REFINEMENT_MIN_SCORE || 80);
const MAX_ITEMS = Number(process.env.MAX_REPORT_REFINEMENT_ITEMS || 15);
const CONCURRENCY = Number(process.env.REPORT_REFINEMENT_CONCURRENCY || 2);
const VERSION = "weekly-report-writing-v2-cost-optimized";

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
    "반드시 JSON 객체만 출력하고 키는 reportBullet, reportSubBullets, reportImplication만 사용하라.",
    "reportBullet: '- ' 없이 정확히 1문장. 'M.D, 주체, 핵심 사실·평가' 구조의 간결한 명사형 보고서 문체.",
    "reportSubBullets: '* ' 없이 1~2개. reportBullet을 반복하지 말고 근거가 있는 배경·조건·파급효과만 작성.",
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
  const byKey = new Map(refined.map((item) => [item.id || item.url, item]));
  payload.articles = (payload.articles || []).map((item) => byKey.get(item.id || item.url) || item);
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
