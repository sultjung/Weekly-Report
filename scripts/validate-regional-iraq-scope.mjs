#!/usr/bin/env node
/** Regression checks for Iraq-focused regional collection. */

import fs from "node:fs/promises";
import path from "node:path";
import { isRegionalIraqExposure, regionalIraqExposureReason } from "./filter-regional-iraq-exposure.mjs";

const ROOT = process.cwd();
const keywords = JSON.parse(await fs.readFile(path.join(ROOT, "data", "search-keywords.json"), "utf8"));
const regionalQueries = [
  ...(keywords.korean_middle_east || []),
  ...(keywords.english_middle_east_fallback || [])
];

for (const forbidden of ["Lebanon", "Hezbollah", "레바논", "헤즈볼라", "civil nuclear", "원자력 협력"]) {
  if (regionalQueries.some((query) => String(query).toLowerCase().includes(forbidden.toLowerCase()))) {
    throw new Error(`Regional query must remain Iraq-operational only; forbidden term found: ${forbidden}`);
  }
}

for (const required of [
  "\"이라크\" \"영공 폐쇄\"",
  "\"이라크\" \"시리아 국경\" \"ISIS\"",
  "\"Iraq\" \"airspace closure\"",
  "\"Iraq\" \"Hormuz\" \"oil exports\""
]) {
  if (!regionalQueries.includes(required)) throw new Error(`Required Iraq operational query missing: ${required}`);
}

const shouldReject = [
  {
    title: "Lebanon and Hezbollah exchange fire near the border",
    description: "Regional security tensions continue without an Iraq connection"
  },
  {
    title: "Iran and Israel exchange missile attacks",
    description: "The conflict intensified across the region"
  },
  {
    title: "Syria deploys forces near its northern border",
    description: "Domestic Syrian security operation"
  }
];
for (const article of shouldReject) {
  if (isRegionalIraqExposure(article)) {
    throw new Error(`Unrelated neighbouring-country security article passed: ${article.title}`);
  }
}

const shouldKeep = [
  {
    title: "Iraq closes its airspace after regional missile attacks",
    description: "Baghdad airport flights were suspended"
  },
  {
    title: "Iraq reinforces the Syria border against ISIS infiltration",
    description: "Iraqi border forces deployed near the crossing"
  },
  {
    title: "Hormuz disruption threatens Iraqi oil exports",
    description: "Iraq reviewed tanker movements from Basra ports"
  },
  {
    title: "Attack reported at Ain al-Asad air base in Iraq",
    description: "The Iraqi base hosting US forces was targeted"
  }
];
for (const article of shouldKeep) {
  if (!isRegionalIraqExposure(article)) {
    throw new Error(`Direct Iraq operational exposure was rejected: ${article.title} (${regionalIraqExposureReason(article)})`);
  }
}

console.log(`Validated ${regionalQueries.length} Iraq-focused regional queries and operational exposure rules.`);
