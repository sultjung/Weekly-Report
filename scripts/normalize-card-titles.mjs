#!/usr/bin/env node
/**
 * Keep publication/report dates out of dashboard-facing card titles.
 * Dates belong to the card metadata and to reportBullet only.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");

function removeLeadingDate(value = "") {
  return String(value || "")
    .replace(/^\s*(?:(?:19|20)\d{2}\s*[./-]\s*)?\d{1,2}\s*[./-]\s*\d{1,2}\s*\.?\s*[,，:：\-–—]\s*/, "")
    .trim();
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  let changed = 0;

  payload.articles = articles.map((article) => {
    const titleKo = removeLeadingDate(article.titleKo);
    const eventTitleKo = removeLeadingDate(article.eventTitleKo);
    if ((titleKo && titleKo !== article.titleKo) || (eventTitleKo && eventTitleKo !== article.eventTitleKo)) {
      changed += 1;
      return {
        ...article,
        ...(titleKo ? { titleKo } : {}),
        ...(eventTitleKo ? { eventTitleKo } : {})
      };
    }
    return article;
  });

  if (changed) await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Normalized card titles: ${changed}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
