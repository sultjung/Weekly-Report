#!/usr/bin/env node
/**
 * Fix recursive glossary artifacts in generated Korean news text.
 *
 * Example:
 *   Nouri Nouri Nouri Al-Maliki 前 총리 前 총리
 * becomes:
 *   Nouri Al-Maliki 前 총리
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const STRING_FIELDS = [
  "titleKo",
  "summaryKo",
  "weeklyReportReason",
  "reportBullet",
  "reportImplication",
  "location",
  "sourceReliability"
];

const ARRAY_FIELDS = ["reportSubBullets", "actors"];

const RULES = [
  // Collapse all repeated Maliki forms.
  [/(?:Nouri\s+)+Al-Maliki(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
  [/Nouri\s+Al-Maliki\s+총리/giu, "Nouri Al-Maliki 前 총리"],
  [/Nouri\s+Nouri\s+/giu, "Nouri "],
  [/Nouri\s+Al-Maliki\s+前\s*총리(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],

  // Generic duplicate title cleanup.
  [/前\s*총리(?:\s+前\s*총리)+/giu, "前 총리"],
  [/총리(?:\s+총리)+/giu, "총리"],

  // Other known PM names.
  [/Al-Zaidi\s+총리(?:\s+총리)+/giu, "Al-Zaidi 총리"],
  [/Al-Sudani\s+前\s*총리(?:\s+前\s*총리)+/giu, "Al-Sudani 前 총리"]
];

function cleanText(value = "") {
  let out = String(value || "");
  for (let pass = 0; pass < 5; pass += 1) {
    const before = out;
    for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
    if (out === before) break;
  }
  return out.replace(/[ \t]+/g, " ").trim();
}

function cleanArticle(article = {}) {
  const next = { ...article };
  let changed = false;

  for (const field of STRING_FIELDS) {
    if (typeof next[field] !== "string") continue;
    const before = next[field];
    next[field] = cleanText(next[field]);
    if (next[field] !== before) changed = true;
  }

  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(next[field])) continue;
    const before = JSON.stringify(next[field]);
    next[field] = next[field].map(cleanText).filter(Boolean);
    if (JSON.stringify(next[field]) !== before) changed = true;
  }

  if (changed) {
    next.recursiveGlossaryArtifactFixed = true;
    next.recursiveGlossaryArtifactFixedAt = new Date().toISOString();
  }
  return { article: next, changed };
}

function recalcCounts(articles = []) {
  return {
    total: articles.length,
    politics: articles.filter((x) => x.category3 === "politics").length,
    terror_security: articles.filter((x) => x.category3 === "terror_security").length,
    oil_economy: articles.filter((x) => x.category3 === "oil_economy").length,
    regional: articles.filter((x) => x.category3 === "regional").length,
    exclude: articles.filter((x) => x.category3 === "exclude" || x.reportUsefulness === "exclude").length
  };
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  let fixedCount = 0;
  const fixed = articles.map((article) => {
    const result = cleanArticle(article);
    if (result.changed) fixedCount += 1;
    return result.article;
  });

  payload.articles = fixed;
  payload.counts = recalcCounts(fixed);
  payload.recursiveGlossaryArtifactFixedCount = fixedCount;
  payload.recursiveGlossaryArtifactFixedAt = new Date().toISOString();
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");

  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.counts = payload.counts;
    index.recursiveGlossaryArtifactFixedCount = fixedCount;
    index.recursiveGlossaryArtifactFixedAt = payload.recursiveGlossaryArtifactFixedAt;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}

  console.log(`Recursive glossary artifacts fixed: ${fixedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
