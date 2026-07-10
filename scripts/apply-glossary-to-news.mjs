#!/usr/bin/env node
/**
 * Apply cumulative translation glossary to data/news.json.
 *
 * This is a deterministic postprocessor. The model itself is not retrained,
 * but user-approved terminology is stored in data/translation-glossary.json
 * and applied every time the collection workflow runs.
 */

import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const NEWS_FILE = path.join(DATA_DIR, "news.json");
const GLOSSARY_FILE = path.join(DATA_DIR, "translation-glossary.json");

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

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeSpace(value = "") {
  return String(value || "").replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").trim();
}

function buildReplacementRules(glossary) {
  const rules = [];
  for (const term of glossary.terms || []) {
    if (!term || term.enabled === false || !term.preferredKo) continue;
    const variants = [term.source, ...(term.aliases || [])]
      .filter(Boolean)
      .map((x) => String(x).trim())
      .filter(Boolean);
    for (const variant of variants) {
      rules.push({
        from: variant,
        to: term.preferredKo,
        regex: new RegExp(escapeRegExp(variant), "giu")
      });
    }
  }
  // Longest first so 'رئيس الهيئة الوطنية للاستثمار' is handled before 'الهيئة الوطنية للاستثمار'.
  return rules.sort((a, b) => b.from.length - a.from.length);
}

function buildCleanupRules(glossary) {
  return (glossary.cleanupRules || [])
    .filter((rule) => rule && rule.pattern !== undefined && rule.replacement !== undefined)
    .map((rule) => ({ regex: new RegExp(rule.pattern, "giu"), to: rule.replacement }));
}

function applyRules(value, replacementRules, cleanupRules) {
  if (typeof value !== "string" || !value) return value;
  let out = value;
  for (const rule of replacementRules) out = out.replace(rule.regex, rule.to);
  for (const rule of cleanupRules) out = out.replace(rule.regex, rule.to);
  return normalizeSpace(out);
}

function applyToArticle(article, replacementRules, cleanupRules) {
  const next = { ...article };
  let changed = false;

  for (const field of STRING_FIELDS) {
    if (typeof next[field] !== "string") continue;
    const before = next[field];
    next[field] = applyRules(next[field], replacementRules, cleanupRules);
    if (next[field] !== before) changed = true;
  }

  for (const field of ARRAY_FIELDS) {
    if (!Array.isArray(next[field])) continue;
    const before = JSON.stringify(next[field]);
    next[field] = next[field].map((value) => applyRules(value, replacementRules, cleanupRules)).filter(Boolean);
    if (JSON.stringify(next[field]) !== before) changed = true;
  }

  if (changed) {
    next.glossaryApplied = true;
    next.glossaryVersion = "weekly-report-translation-glossary-v1";
  }

  return { article: next, changed };
}

async function main() {
  const [newsRaw, glossaryRaw] = await Promise.all([
    fs.readFile(NEWS_FILE, "utf8"),
    fs.readFile(GLOSSARY_FILE, "utf8")
  ]);

  const news = JSON.parse(newsRaw);
  const glossary = JSON.parse(glossaryRaw);
  const replacementRules = buildReplacementRules(glossary);
  const cleanupRules = buildCleanupRules(glossary);

  const articles = Array.isArray(news.articles) ? news.articles : [];
  let changedCount = 0;
  news.articles = articles.map((article) => {
    const result = applyToArticle(article, replacementRules, cleanupRules);
    if (result.changed) changedCount += 1;
    return result.article;
  });

  news.glossary = {
    version: glossary.version || "unknown",
    appliedAt: new Date().toISOString(),
    termCount: (glossary.terms || []).filter((x) => x && x.enabled !== false).length,
    changedCount
  };

  await fs.writeFile(NEWS_FILE, JSON.stringify(news, null, 2) + "\n", "utf8");
  console.log(`[glossary] applied terms=${news.glossary.termCount}, changedArticles=${changedCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
