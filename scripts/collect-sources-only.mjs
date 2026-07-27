#!/usr/bin/env node
/**
 * Canonical source-collection entrypoint.
 * Explicitly removes OpenAI variables so collect-news.mjs can only collect and
 * hydrate source material. AI work belongs to extract-article-facts.mjs.
 */
import { spawnSync } from "node:child_process";

const env = {
  ...process.env,
  OPENAI_API_KEY: "",
  OPENAI_MODEL: "",
  OPENAI_SUMMARY_MODEL: "",
  OPENAI_SUMMARY_FALLBACK_MODEL: ""
};

const result = spawnSync(process.execPath, ["scripts/collect-news.mjs"], {
  stdio: "inherit",
  env
});
if (result.error) throw result.error;
process.exit(result.status || 0);
