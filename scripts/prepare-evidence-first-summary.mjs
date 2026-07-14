#!/usr/bin/env node
/**
 * Patch the generated Weekly-Report collector with an evidence-first AI flow.
 *
 * Order:
 * 1) deterministic keyword/rule selection (already completed by the collector)
 * 2) full-text hydration only for selected, uncached articles
 * 3) one-pass Korean summary/classification from source evidence
 * 4) one retry when the output appears to swap Iraq and Iran as a place/actor
 *
 * Country names are never force-replaced.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const TARGET = path.join(ROOT, "scripts", "collect-news.expanded.mjs");

function replaceOnce(source, search, replacement, label) {
  if (!source.includes(search)) throw new Error(`Patch anchor not found: ${label}`);
  return source.replace(search, replacement);
}

function replaceRegexOnce(source, regex, replacement, label) {
  if (!regex.test(source)) throw new Error(`Patch regex not found: ${label}`);
  return source.replace(regex, replacement);
}

let code = await fs.readFile(TARGET, "utf8");

code = replaceOnce(
  code,
  `const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 10000);`,
  `const MAX_ARTICLE_TEXT_CHARS = Number(process.env.MAX_ARTICLE_TEXT_CHARS || 10000);\nconst FULLTEXT_HYDRATION_CONCURRENCY = Number(process.env.FULLTEXT_HYDRATION_CONCURRENCY || 4);\nconst MIN_FULLTEXT_CHARS_FOR_AI = Number(process.env.MIN_FULLTEXT_CHARS_FOR_AI || 500);\nconst MIN_RSS_DESCRIPTION_CHARS_FOR_AI = Number(process.env.MIN_RSS_DESCRIPTION_CHARS_FOR_AI || 300);\nconst HIGH_PRIORITY_RSS_FALLBACK_SCORE = Number(process.env.HIGH_PRIORITY_RSS_FALLBACK_SCORE || 90);\nconst MAX_NEW_AI_ITEMS = Number(process.env.MAX_NEW_AI_ITEMS || 120);`,
  "evidence-first runtime constants"
);

const helperAnchor = `async function collectGoogleNews() {`;
const helperBlock = `function sourceEvidenceText(item = {}) {\n  return normalizeText(item.cleanText || item.fullText || item.description || \"\");\n}\n\nfunction hasUsableFullText(item = {}) {\n  return normalizeText(item.cleanText || item.fullText || \"\").length >= MIN_FULLTEXT_CHARS_FOR_AI;\n}\n\nfunction evidenceLevelFor(item = {}) {\n  if (hasUsableFullText(item)) return \"fulltext\";\n  if (normalizeText(item.description || \"\").length >= MIN_RSS_DESCRIPTION_CHARS_FOR_AI) return \"rss-description\";\n  return \"insufficient\";\n}\n\nasync function hydrateSelectedArticle(item = {}) {\n  if (hasUsableFullText(item)) {\n    return {\n      ...item,\n      sourceEvidenceLevel: \"fulltext\",\n      sourceEvidenceChars: sourceEvidenceText(item).length\n    };\n  }\n\n  if (!item.url || !/^https?:/i.test(item.url)) {\n    return {\n      ...item,\n      sourceEvidenceLevel: evidenceLevelFor(item),\n      sourceEvidenceChars: sourceEvidenceText(item).length\n    };\n  }\n\n  const controller = new AbortController();\n  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);\n  try {\n    const res = await fetch(item.url, {\n      redirect: \"follow\",\n      signal: controller.signal,\n      headers: {\n        \"user-agent\": \"Mozilla/5.0 Iraq Weekly Report Evidence Hydrator\",\n        accept: \"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\"\n      }\n    });\n    if (!res.ok) throw new Error(\`HTTP \${res.status} \${res.statusText}\`);\n\n    const html = await res.text();\n    const finalUrl = res.url || item.url;\n    const finalHost = hostnameOf(finalUrl);\n\n    if (finalHost && finalHost !== \"news.google.com\") {\n      const parsed = parseArticleHtml(\n        html,\n        finalUrl,\n        { name: item.source || finalHost || \"Iraq media\" },\n        item.publishedAt || \"\"\n      );\n\n      if (parsed && hasUsableFullText(parsed)) {\n        return {\n          ...item,\n          title: parsed.title || item.title,\n          source: item.source || parsed.source,\n          publishedAt: item.publishedAt || parsed.publishedAt,\n          url: parsed.url || finalUrl,\n          description: parsed.description || item.description,\n          cleanText: parsed.cleanText,\n          fullText: parsed.fullText,\n          sourceEvidenceLevel: \"fulltext\",\n          sourceEvidenceChars: sourceEvidenceText(parsed).length\n        };\n      }\n    }\n  } catch (err) {\n    console.warn(\`[fulltext] \${String(item.title || \"\").slice(0, 90)} - \${err.message || err}\`);\n  } finally {\n    clearTimeout(timer);\n  }\n\n  return {\n    ...item,\n    sourceEvidenceLevel: evidenceLevelFor(item),\n    sourceEvidenceChars: sourceEvidenceText(item).length\n  };\n}\n\nfunction canSummarizeFromEvidence(item = {}) {\n  if (item.sourceEvidenceLevel === \"fulltext\") return true;\n  return item.sourceEvidenceLevel === \"rss-description\" &&\n    Number(item.importanceScore || 0) >= HIGH_PRIORITY_RSS_FALLBACK_SCORE;\n}\n\nfunction koreanOutputText(parsed = {}) {\n  return [\n    parsed.titleKo,\n    parsed.summaryKo,\n    parsed.reportBullet,\n    ...(Array.isArray(parsed.reportSubBullets) ? parsed.reportSubBullets : [])\n  ].filter(Boolean).join(\"\\n\");\n}\n\nfunction responseHasCountryShift(item = {}, parsed = {}) {\n  const source = sourceEvidenceText(item);\n  const output = koreanOutputText(parsed).replace(/친이란/g, \"\");\n  const sourceHasIraq = hasAny(source, [\"العراق\", \"العراقي\", \"بغداد\", \"iraq\", \"iraqi\", \"baghdad\", \"이라크\", \"바그다드\"]);\n  const sourceHasIran = hasAny(source, [\"إيران\", \"ايران\", \"طهران\", \"iran\", \"tehran\", \"teheran\", \"이란\", \"테헤란\"]);\n  const outputHasIraqAsPlace = /이라크(?:\\s*(?:내|에서|에|로|정부|의회|총리|대통령|투자|사업|재건|귀환|방문))|Baghdad|바그다드/i.test(output);\n  const outputHasIranAsPlace = /이란(?:\\s*(?:내|에서|에|으로|정부|의회|총리|대통령|투자|사업|재건|귀환|방문))|Teh?eran|테헤란/i.test(output);\n\n  return (sourceHasIraq && !sourceHasIran && outputHasIranAsPlace) ||\n    (sourceHasIran && !sourceHasIraq && outputHasIraqAsPlace);\n}\n\n${helperAnchor}`;

code = replaceOnce(code, helperAnchor, helperBlock, "evidence hydration helpers");

code = code.split(`weekly-report-v4`).join(`weekly-report-v5-evidence`);

code = replaceRegexOnce(
  code,
  /function hasReusableAiSummary\(item = \{\}\) \{ return !!\([\s\S]*?\); \}/,
  `function hasReusableAiSummary(item = {}) {\n  const evidenceBacked = item.sourceEvidenceLevel === \"fulltext\" ||\n    item.sourceEvidenceLevel === \"rss-description\" ||\n    hasUsableFullText(item);\n  return !!(\n    item.titleKo && item.summaryKo &&\n    item.aiSummaryVersion === \"weekly-report-v5-evidence\" &&\n    evidenceBacked &&\n    !hasArabic(item.titleKo) && !hasArabic(item.summaryKo) &&\n    !item.translationFailed &&\n    !responseHasCountryShift(item, item)\n  );\n}`,
  "evidence-backed cache rule"
);

code = replaceOnce(
  code,
  `  const input = JSON.stringify({ title: item.title, source: item.source, publishedAt: item.publishedAt, url: item.url, description: item.description, text, initialCategory: item.category3, initialReason: item.weeklyReportReason }, null, 2);`,
  `  const input = JSON.stringify({\n    title: item.title,\n    source: item.source,\n    publishedAt: item.publishedAt,\n    url: item.url,\n    description: item.description,\n    text,\n    sourceEvidenceLevel: item.sourceEvidenceLevel || evidenceLevelFor(item),\n    sourceEvidenceChars: Number(item.sourceEvidenceChars || sourceEvidenceText(item).length),\n    initialCategory: item.category3,\n    initialReason: item.weeklyReportReason\n  }, null, 2);`,
  "AI input evidence metadata"
);

code = replaceOnce(
  code,
  `    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",`,
  `    "아래 이라크/중동 관련 기사를 주간 종합상황보고서 후보 기사로 분류·요약하라.",\n    "원문을 별도로 요약한 뒤 다시 번역하지 말고, 제공된 원문 근거에서 바로 한국어 핵심 요약을 한 번에 작성하라.",\n    "국가명·기관명·인명·날짜·수치·투자 대상은 원문 표기를 보존하고 서로 다른 기사나 배경지식을 섞지 말라.",\n    "sourceEvidenceLevel이 fulltext이면 본문 전체를 우선하고, rss-description이면 제목·설명에서 확인되는 사실 이상으로 확대하지 말라.",`,
  "one-pass source-faithful prompt"
);

code = replaceOnce(
  code,
  `    const parsed = parseJsonObject(await aiKorean(prompt, input));\n    if (!parsed || !parsed.titleKo || !parsed.summaryKo || hasArabic(parsed.titleKo) || hasArabic(parsed.summaryKo)) throw new Error("bad AI JSON");`,
  `    let parsed = parseJsonObject(await aiKorean(prompt, input));\n    const invalid = () => !parsed || !parsed.titleKo || !parsed.summaryKo || hasArabic(parsed.titleKo) || hasArabic(parsed.summaryKo);\n\n    if (invalid() || responseHasCountryShift(item, parsed)) {\n      const retryPrompt = [\n        prompt,\n        \"이전 응답을 원문과 다시 대조하라. 특히 이라크와 이란, 투자 대상국, 기관·인명·날짜·수치를 바꾸거나 섞지 말라.\",\n        \"문자열을 기계적으로 치환하지 말고 원문 문맥을 다시 읽어 JSON 전체를 새로 작성하라.\"\n      ].join(\"\\n\");\n      parsed = parseJsonObject(await aiKorean(retryPrompt, input));\n    }\n\n    if (invalid() || responseHasCountryShift(item, parsed)) throw new Error(\"bad or source-inconsistent AI JSON\");`,
  "soft source-consistency retry"
);

code = replaceOnce(
  code,
  `  const toEnrich = articles.filter((x) => !x.aiCacheHit);\n  const enriched = OPENAI_API_KEY ? await mapLimit(toEnrich, AI_CONCURRENCY, enrichArticle) : toEnrich;\n  const enrichedMap = new Map(enriched.map((item) => [canonicalKey(item), item]));\n  articles = articles.map((item) => item.aiCacheHit ? item : (enrichedMap.get(canonicalKey(item)) || item)).filter((item) => item.reportUsefulness !== "exclude" || item.category3 === "exclude");`,
  `  const toHydrate = articles.filter((x) => !x.aiCacheHit);\n  const hydrated = await mapLimit(toHydrate, FULLTEXT_HYDRATION_CONCURRENCY, hydrateSelectedArticle);\n  const hydratedMap = new Map(hydrated.map((item) => [canonicalKey(item), item]));\n  articles = articles.map((item) => item.aiCacheHit ? item : (hydratedMap.get(canonicalKey(item)) || item));\n\n  const eligible = articles\n    .filter((item) => !item.aiCacheHit && canSummarizeFromEvidence(item))\n    .sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0) || new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))\n    .slice(0, MAX_NEW_AI_ITEMS);\n\n  const enriched = OPENAI_API_KEY ? await mapLimit(eligible, AI_CONCURRENCY, enrichArticle) : eligible;\n  const enrichedMap = new Map(enriched.map((item) => [canonicalKey(item), item]));\n  articles = articles.map((item) => {\n    if (item.aiCacheHit) return item;\n    const result = enrichedMap.get(canonicalKey(item));\n    if (result) return result;\n    return {\n      ...item,\n      reportUsefulness: \"exclude\",\n      category3: \"exclude\",\n      translationFailed: true,\n      evidenceInsufficient: true,\n      weeklyReportReason: item.sourceEvidenceLevel === \"insufficient\"\n        ? \"기사 전문 또는 충분한 원문 설명 미확보\"\n        : \"AI 처리 상한 초과\"\n    };\n  }).filter((item) => item.reportUsefulness !== \"exclude\" || item.category3 === \"exclude\");\n\n  const evidenceStats = {\n    fulltext: articles.filter((x) => x.sourceEvidenceLevel === \"fulltext\").length,\n    rssDescription: articles.filter((x) => x.sourceEvidenceLevel === \"rss-description\").length,\n    insufficient: articles.filter((x) => x.sourceEvidenceLevel === \"insufficient\").length,\n    aiEligible: eligible.length\n  };\n  console.log(\`[evidence-first] fulltext=\${evidenceStats.fulltext}, rssDescription=\${evidenceStats.rssDescription}, insufficient=\${evidenceStats.insufficient}, aiEligible=\${evidenceStats.aiEligible}\`);`,
  "evidence-first main flow"
);

code = replaceOnce(
  code,
  `  const payload = { category: "iraq-weekly-report-news", generatedAt, lookbackDays: DAYS, count: articles.length, cacheHits, model: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none", counts, articles, debug: { google: google.debug, direct: direct.debug, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) } };`,
  `  const payload = { category: "iraq-weekly-report-news", generatedAt, lookbackDays: DAYS, count: articles.length, cacheHits, model: OPENAI_API_KEY ? OPENAI_SUMMARY_MODEL : "none", counts, articles, debug: { google: google.debug, direct: direct.debug, evidence: evidenceStats, elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) } };`,
  "evidence stats in output"
);

await fs.writeFile(TARGET, code, "utf8");
console.log("Applied evidence-first one-pass Korean summary patch.");
