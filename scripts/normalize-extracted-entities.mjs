#!/usr/bin/env node
/**
 * Normalize actor roles and common locations from source-grounded evidence.
 * This keeps role/place interpretation out of the generative model wherever a
 * deterministic mapping is available.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const NEWS_FILE = path.join(ROOT, "data", "news.json");
const INDEX_FILE = path.join(ROOT, "data", "news-index.json");

const ROLE_RULES = [
  [/رئيس\s+(?:مجلس\s+)?الوزراء|رئيس\s+الحكومة|prime minister|premier/iu, "총리"],
  [/وزير\s+الخارجية|foreign minister/iu, "외무장관"],
  [/رئيس\s+مجلس\s+النواب|parliament speaker|speaker of parliament/iu, "국회의장"],
  [/رئيس\s+الهيئة\s+الوطنية\s+للاستثمار|chair(?:man)? of (?:the )?national investment commission/iu, "NIC 의장"],
  [/محافظ|governor/iu, "주지사"],
  [/نائب|member of parliament|\bmp\b/iu, "국회의원"],
  [/رئيس\s+الجمهورية|president of the republic/iu, "대통령"]
];

const LOCATION_RULES = [
  [/بغداد|baghdad/iu, "Baghdad"],
  [/طهران|تهران|tehran|teheran/iu, "Teheran"],
  [/النجف|najaf/iu, "Najaf"],
  [/كربلاء|karbala/iu, "Karbala"],
  [/البصرة|basra/iu, "Basra"],
  [/أربيل|اربيل|erbil/iu, "Erbil"],
  [/كركوك|kirkuk/iu, "Kirkuk"],
  [/الأنبار|الانبار|anbar/iu, "Anbar"],
  [/ديالى|diyala/iu, "Diyala"],
  [/الموصل|mosul/iu, "Mosul"]
];

function clean(value = "") { return String(value || "").replace(/\s+/g, " ").trim(); }
function sourceLead(article = {}) { return [article.title, article.description, String(article.cleanText || article.fullText || "").slice(0, 3500)].filter(Boolean).join("\n"); }

export function roleFromEvidence(quote = "") {
  for (const [pattern, role] of ROLE_RULES) if (pattern.test(String(quote || ""))) return role;
  return "";
}

export function securityEventTypeFromSource(article = {}) {
  const raw = sourceLead(article);
  if (/تظاهرات|احتجاجات|اعتصام|متظاهرين|protest|demonstration|시위|집회/iu.test(raw)) return "protest";
  if (/عبوة ناسفة|\bied\b|급조폭발물/iu.test(raw)) return "ied";
  if (/انتحاري|suicide bomb|자살폭탄/iu.test(raw)) return "suicide_bombing";
  if (/اغتيال|assassination|암살/iu.test(raw)) return "assassination";
  if (/إطلاق نار|اطلاق نار|shooting|총격/iu.test(raw)) return "shooting";
  if (/هجوم مسلح|هجوم إرهابي|اشتباك|تفجير|قصف|صاروخ|armed attack|terror attack|clash|bombing|rocket attack|무장 공격|테러 공격|교전|폭발|로켓 공격/iu.test(raw)) return "armed_attack";
  return "other";
}

export function unambiguousLocationFromSource(article = {}) {
  const raw = sourceLead(article);
  const found = LOCATION_RULES.filter(([pattern]) => pattern.test(raw)).map(([, location]) => location);
  const unique = [...new Set(found)];
  return unique.length === 1 ? unique[0] : "";
}

function replaceActorRole(text = "", name = "", oldRole = "", newRole = "") {
  let output = String(text || "");
  if (!name || !newRole || oldRole === newRole) return output;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedOld = oldRole.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (oldRole) output = output.replace(new RegExp(`${escapedName}\\s*${escapedOld}`, "g"), `${name} ${newRole}`);
  return output;
}

function normalizeArticle(article = {}) {
  const corrected = { ...article };
  const extracted = Array.isArray(article.extractedActors) ? article.extractedActors.map((actor) => ({ ...actor })) : [];
  let changed = false;

  for (const actor of extracted) {
    const deterministicRole = roleFromEvidence(actor.evidenceQuote);
    if (!deterministicRole || deterministicRole === actor.roleKo) continue;
    const oldRole = clean(actor.roleKo);
    actor.roleKo = deterministicRole;
    for (const key of ["titleKo", "summaryKo", "reportBullet", "weeklyReportReason", "reportImplication"]) {
      corrected[key] = replaceActorRole(corrected[key], actor.nameKo, oldRole, deterministicRole);
    }
    corrected.reportSubBullets = (Array.isArray(corrected.reportSubBullets) ? corrected.reportSubBullets : []).map((value) => replaceActorRole(value, actor.nameKo, oldRole, deterministicRole));
    changed = true;
  }

  const deterministicLocation = unambiguousLocationFromSource(article);
  if (deterministicLocation && deterministicLocation !== article.location) {
    corrected.location = deterministicLocation;
    changed = true;
  }

  if (article.category3 === "terror_security") {
    const deterministicEventType = securityEventTypeFromSource(article);
    if (deterministicEventType !== article.securityEventType) {
      corrected.securityEventType = deterministicEventType;
      corrected.securityEventCount = 1;
      changed = true;
    }
  }

  corrected.extractedActors = extracted;
  corrected.actors = extracted.length
    ? extracted.map((actor) => clean(`${actor.nameKo}${actor.roleKo ? ` ${actor.roleKo}` : ""}`)).filter(Boolean)
    : (Array.isArray(article.actors) ? article.actors : []);
  if (changed) {
    corrected.entityNormalizationApplied = true;
    corrected.entityNormalizedAt = new Date().toISOString();
  }
  return corrected;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(NEWS_FILE, "utf8"));
  const articles = Array.isArray(payload.articles) ? payload.articles : [];
  const normalized = articles.map(normalizeArticle);
  const correctedCount = normalized.filter((article) => article.entityNormalizationApplied).length;
  payload.articles = normalized;
  payload.entityNormalization = { correctedCount, completedAt: new Date().toISOString() };
  await fs.writeFile(NEWS_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  try {
    const index = JSON.parse(await fs.readFile(INDEX_FILE, "utf8"));
    index.entityNormalization = payload.entityNormalization;
    await fs.writeFile(INDEX_FILE, JSON.stringify(index, null, 2) + "\n", "utf8");
  } catch {}
  console.log(`[entities] corrected=${correctedCount}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exit(1); });
}
