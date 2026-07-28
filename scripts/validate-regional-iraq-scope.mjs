#!/usr/bin/env node
/** Regression checks for Iraq-focused regional collection. */
import fs from "node:fs/promises";
import path from "node:path";
import { classifyArticle } from "./extract-article-facts.mjs";
import { isRegionalIraqExposure, regionalIraqExposureReason } from "./filter-regional-iraq-exposure.mjs";

const ROOT = process.cwd();
const keywords = JSON.parse(await fs.readFile(path.join(ROOT, "data", "search-keywords.json"), "utf8"));
const regionalQueries = [...(keywords.english_middle_east_fallback || [])];

if (!regionalQueries.length) throw new Error("English Iraq operational query group is empty");
for (const query of regionalQueries) {
  if (!/Iraq/i.test(String(query))) throw new Error(`Regional query must include Iraq: ${query}`);
  if (/[가-힣]/.test(String(query))) throw new Error(`Korean query must not appear in regional group: ${query}`);
}

for (const forbidden of ["Lebanon", "Hezbollah", "civil nuclear", "Gaza", "Hamas"]) {
  if (regionalQueries.some((query) => String(query).toLowerCase().includes(forbidden.toLowerCase()))) {
    throw new Error(`Regional query must remain Iraq-operational only; forbidden term found: ${forbidden}`);
  }
}

for (const required of [
  "\"Iraq\" \"airspace closure\"",
  "\"Iraq\" \"airport suspension\"",
  "\"Iraq\" \"Hormuz\" \"oil exports\"",
  "\"Iraq\" \"supply chain\" \"border\""
]) {
  if (!regionalQueries.includes(required)) throw new Error(`Required Iraq operational query missing: ${required}`);
}

const shouldReject = [
  { title: "Lebanon and Hezbollah exchange fire near the border", description: "Regional security tensions continue without an Iraq connection" },
  { title: "Iran and Israel exchange missile attacks", description: "The conflict intensified across the region" },
  { title: "Syria deploys forces near its northern border", description: "Domestic Syrian security operation" },
  { title: "Hanwha announces a new overseas technology investment", description: "The project is unrelated to Iraq or Bismayah" }
];
for (const article of shouldReject) {
  if (isRegionalIraqExposure(article)) throw new Error(`Unrelated regional article passed: ${article.title}`);
}

const shouldKeep = [
  { title: "Iraq closes its airspace after regional missile attacks", description: "Baghdad airport flights were suspended" },
  { title: "Iraq reinforces the Syria border against ISIS infiltration", description: "Iraqi border forces deployed near the crossing" },
  { title: "Hormuz disruption threatens Iraqi oil exports", description: "Iraq reviewed tanker movements from Basra ports" },
  { title: "Attack reported at Ain al-Asad air base in Iraq", description: "The Iraqi base hosting US forces was targeted" },
  { title: "Hanwha reviews its Iraq operations after regional airspace closures", description: "The review covers the Bismayah project and Baghdad travel routes" }
];
for (const article of shouldKeep) {
  if (!isRegionalIraqExposure(article)) throw new Error(`Direct Iraq operational exposure was rejected: ${article.title} (${regionalIraqExposureReason(article)})`);
}

const borderClassification = classifyArticle({
  collectionLane: "arabic_iraq_security",
  title: "العراق يغلق الحدود السورية لمنع التسلل والتهريب",
  description: "تعزيز قوات حرس الحدود العراقية عند المعابر"
});
if (!borderClassification.include || borderClassification.category3 !== "terror_security") {
  throw new Error("Iraq border closure/infiltration article must classify as terror_security");
}

const operationalRegional = {
  collectionLane: "regional_context",
  title: "Iraq closes its airspace after regional missile attacks",
  description: "Baghdad airport flights were suspended"
};
operationalRegional.regionalIraqExposureReason = regionalIraqExposureReason(operationalRegional);
const regionalClassification = classifyArticle(operationalRegional);
if (!regionalClassification.include || regionalClassification.category3 !== "regional") {
  throw new Error("Validated Iraq airspace exposure must classify as regional");
}

console.log(`Validated ${regionalQueries.length} English Iraq-focused regional queries and operational exposure rules.`);