#!/usr/bin/env node
/** One-time refactor: collapse patch-generated runtime code into stable entry points. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const p = (...parts) => path.join(ROOT, ...parts);
const read = (file) => fs.readFile(p(file), "utf8");
const write = (file, content) => fs.writeFile(p(file), content, "utf8");

function run(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

// Build the fully patched collector once, then promote it to the canonical source.
run("scripts/run-collector.mjs", ["--prepare-only"]);
let collector = await read("scripts/collect-news.expanded.mjs");
collector = collector.replace(
  'const INDEX_FILE = path.join(DATA_DIR, "news-index.json");',
  'const INDEX_FILE = path.join(DATA_DIR, "news-index.json");\nconst SEARCH_KEYWORDS_FILE = path.join(DATA_DIR, "search-keywords.json");'
);
collector = collector.replace(
  'const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini";',
  'const OPENAI_SUMMARY_MODEL = process.env.OPENAI_SUMMARY_MODEL || process.env.OPENAI_MODEL || "gpt-5.4-mini";'
);
const queryPattern = /const GOOGLE_NEWS_QUERIES = \[.*?\n\];\n\nfunction nowIso\(\)/s;
if (!queryPattern.test(collector)) throw new Error("Unable to replace generated Google News query block");
collector = collector.replace(queryPattern, `async function loadGoogleNewsQueries() {
  const config = JSON.parse(await fs.readFile(SEARCH_KEYWORDS_FILE, "utf8"));
  const queries = Object.entries(config)
    .filter(([key]) => !key.startsWith("_"))
    .flatMap(([, values]) => Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  if (!queries.length) throw new Error("No Google News queries configured in data/search-keywords.json");
  if (new Set(queries).size !== queries.length) throw new Error("Duplicate Google News queries found in data/search-keywords.json");
  return queries;
}

const GOOGLE_NEWS_QUERIES = await loadGoogleNewsQueries();

function nowIso()`);
await write("scripts/collect-news.mjs", collector);

// Preserve the exact browser execution order, but deploy it as one asset.
const browserFiles = [
  "app-fixed-v20.js",
  "report-format-overrides.js",
  "report-no-overmerge.js",
  "report-font-overrides.js",
  "report-ruler-overrides.js",
  "report-writing-cleanup.js",
  "report-human-sample-style.js",
  "client-side-safety-guard.js",
  "client-side-terminology-cleanup.js",
  "client-side-known-article-corrections.js",
  "client-side-deduplicate-news.js"
];
const bundle = [
  `/**
 * Weekly-Report browser application bundle.
 *
 * The previous execution order is preserved while replacing separately loaded
 * patch files with one deployable asset.
 */\n`
];
for (const file of browserFiles) {
  bundle.push(`\n/* ===== ${file} ===== */\n${(await read(file)).trimEnd()}\n`);
}
await write("app.js", bundle.join("\n"));

let indexHtml = await read("index.html");
indexHtml = indexHtml.replace(
  /\n\s*<script src="\.\/app-fixed-v20\.js\?v=\d+"><\/script>[\s\S]*?<script src="\.\/client-side-deduplicate-news\.js\?v=\d+"><\/script>/,
  '\n  <script src="./app.js?v=33"></script>'
);
await write("index.html", indexHtml);

const pkg = JSON.parse(await read("package.json"));
pkg.scripts = {
  collect: "node scripts/collect-news.mjs",
  postprocess: "node scripts/postprocess-news.mjs",
  report: "node scripts/generate-weekly-report.mjs",
  validate: "node scripts/validate-project.mjs"
};
await write("package.json", `${JSON.stringify(pkg, null, 2)}\n`);

await write("scripts/postprocess-news.mjs", `#!/usr/bin/env node
/** Run all news-data cleanup steps in their required order. */
import { spawnSync } from "node:child_process";

const steps = [
  "scripts/apply-glossary-to-news.mjs",
  "scripts/fix-recursive-glossary-artifacts.mjs",
  "scripts/fix-known-political-summaries.mjs",
  "scripts/filter-untranslated-news.mjs",
  "scripts/fix-agency-dateline-location-errors.mjs",
  "scripts/filter-ai-hallucinated-actors.mjs",
  "scripts/filter-irrelevant-foreign-news.mjs",
  "scripts/deduplicate-news-articles.mjs"
];

for (const script of steps) {
  console.log(`\n[postprocess] ${script}`);
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("\nNews post-processing completed.");
`);

await write("scripts/validate-project.mjs", `#!/usr/bin/env node
/** Lightweight structural validation for the repository. */
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const readJson = async (file) => JSON.parse(await fs.readFile(path.join(ROOT, file), "utf8"));

const keywordConfig = await readJson("data/search-keywords.json");
const queries = Object.entries(keywordConfig)
  .filter(([key]) => !key.startsWith("_"))
  .flatMap(([, values]) => Array.isArray(values) ? values : []);
if (!queries.length) throw new Error("Search keyword list is empty");
if (new Set(queries).size !== queries.length) throw new Error("Duplicate search keywords found");
for (const required of ["\"بسماية\"", "\"شركة هانوا\""]) {
  if (!queries.includes(required)) throw new Error(`Required search keyword missing: ${required}`);
}

const sources = await readJson("data/iraq-media-sources.json");
const sourceText = JSON.stringify(sources).toLowerCase();
if (sourceText.includes("ninanews.com") || sources.some((source) => String(source.id || "").toLowerCase() === "nina")) {
  throw new Error("NINA must remain excluded from configured sources");
}

const indexHtml = await fs.readFile(path.join(ROOT, "index.html"), "utf8");
const scriptRefs = [...indexHtml.matchAll(/<script\s+src="\.\/([^"?]+)(?:\?[^\"]*)?"/g)].map((match) => match[1]);
if (scriptRefs.length !== 1 || scriptRefs[0] !== "app.js") {
  throw new Error(`index.html must load only app.js; found: ${scriptRefs.join(", ")}`);
}

const syntaxFiles = [
  "app.js",
  "scripts/collect-news.mjs",
  "scripts/postprocess-news.mjs",
  "scripts/generate-weekly-report.mjs",
  "scripts/validate-project.mjs",
  "scripts/apply-glossary-to-news.mjs",
  "scripts/fix-recursive-glossary-artifacts.mjs",
  "scripts/fix-known-political-summaries.mjs",
  "scripts/filter-untranslated-news.mjs",
  "scripts/fix-agency-dateline-location-errors.mjs",
  "scripts/filter-ai-hallucinated-actors.mjs",
  "scripts/filter-irrelevant-foreign-news.mjs",
  "scripts/deduplicate-news-articles.mjs"
];
for (const file of syntaxFiles) {
  await fs.access(path.join(ROOT, file));
  const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Validated ${queries.length} search queries, ${sources.length} media sources and ${syntaxFiles.length} JavaScript files.`);
`);

// Replace the long workflow command lists with stable package entry points.
let collectWorkflow = await read(".github/workflows/collect-news.yml");
const collectStart = collectWorkflow.indexOf("      - name: Collect Iraq weekly news");
const collectEnd = collectWorkflow.indexOf("      - name: Sync latest main before commit");
if (collectStart < 0 || collectEnd < 0) throw new Error("Collect workflow anchors not found");
collectWorkflow = collectWorkflow.slice(0, collectStart) + `      - name: Collect and post-process Iraq weekly news
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          OPENAI_SUMMARY_MODEL: ${{ vars.OPENAI_SUMMARY_MODEL || 'gpt-5.4-mini' }}
          NEWS_LOOKBACK_DAYS: "30"
          MAX_PER_QUERY: "12"
          MAX_TOTAL: "260"
          FETCH_TIMEOUT_MS: "12000"
          GOOGLE_QUERY_CONCURRENCY: "6"
          SOURCE_CONCURRENCY: "3"
          ARTICLE_FETCH_CONCURRENCY: "4"
          AI_CONCURRENCY: "5"
          FULLTEXT_HYDRATION_CONCURRENCY: "4"
          MIN_FULLTEXT_CHARS_FOR_AI: "500"
          MIN_RSS_DESCRIPTION_CHARS_FOR_AI: "300"
          HIGH_PRIORITY_RSS_FALLBACK_SCORE: "90"
          MAX_NEW_AI_ITEMS: "120"
        run: |
          for attempt in 1 2 3; do
            echo "Collect Iraq weekly news attempt ${attempt}/3"
            if npm run collect && npm run postprocess; then
              echo "Collect Iraq weekly news succeeded"
              exit 0
            fi
            if [ "$attempt" = "3" ]; then
              echo "Collect Iraq weekly news failed after 3 attempts"
              exit 1
            fi
            sleep $((attempt * 90))
          done

` + collectWorkflow.slice(collectEnd);
collectWorkflow = collectWorkflow.replace("run: npm install", "run: npm ci");
await write(".github/workflows/collect-news.yml", collectWorkflow);

let reportWorkflow = await read(".github/workflows/generate-weekly-report.yml");
reportWorkflow = reportWorkflow.replace("run: npm install", "run: npm ci");
await write(".github/workflows/generate-weekly-report.yml", reportWorkflow);

await write(".github/workflows/validate-evidence-summary.yml", `name: Validate Weekly-Report Structure

on:
  pull_request:
    paths:
      - "index.html"
      - "app.js"
      - "package.json"
      - "package-lock.json"
      - "data/search-keywords.json"
      - "data/iraq-media-sources.json"
      - "scripts/**"
      - ".github/workflows/**"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: "24"
          cache: npm

      - name: Install dependencies
        run: npm ci

      - name: Validate project structure and syntax
        run: npm run validate

      - name: Smoke-test DOCX generation
        run: |
          node - <<'NODE' > /tmp/selection.json
          const fs = require('fs');
          const payload = JSON.parse(fs.readFileSync('data/news.json', 'utf8'));
          const article = (payload.articles || []).find((item) => item.titleKo && ['politics','terror_security','oil_economy','regional'].includes(item.category3));
          if (!article) throw new Error('No report article available for smoke test');
          process.stdout.write(JSON.stringify([article]));
          NODE
          SELECTION_JSON="$(cat /tmp/selection.json)" REPORT_DATE="2026-07-14" REPORT_START_DATE="2026-07-07" REPORT_END_DATE="2026-07-13" npm run report
          test -s reports/latest.docx
`);

await write("README.md", `# Iraq Weekly Report Builder

이라크 정치·치안·경제·비스마야 관련 뉴스를 수집하고, 한국어 주간보고서 후보와 DOCX 보고서를 생성하는 GitHub Pages 프로젝트입니다.

## 핵심 구조

\`\`\`text
index.html / style.css / app.js     웹 화면
data/search-keywords.json           Google News 검색어 단일 관리
data/iraq-media-sources.json        직접 수집 언론사 목록
scripts/collect-news.mjs             뉴스 수집·전문 확보·AI 요약
scripts/postprocess-news.mjs         번역 용어·오류·중복 후처리 실행
scripts/generate-weekly-report.mjs   DOCX 보고서 생성
\`\`\`

## 실행

\`\`\`bash
npm run validate      # 구조·문법·필수 설정 검사
npm run collect       # 뉴스 수집
npm run postprocess   # 수집 데이터 후처리
npm run report        # 선택 기사 DOCX 생성
\`\`\`

GitHub Actions의 \`Collect Iraq Weekly News\`도 동일한 \`collect → postprocess\` 경로를 사용합니다.

## 검색어 수정

검색어는 \`data/search-keywords.json\` 한 파일에서만 관리합니다. 자세한 형식은 \`SEARCH_KEYWORDS.md\`를 참고하세요.

## 유지보수 원칙

- 브라우저 코드는 \`app.js\` 한 파일만 배포합니다.
- 수집기는 실행 중 별도 패치 파일을 생성하지 않습니다.
- NINA는 본문·사이드바 혼입 문제로 수집 대상에서 제외합니다.
- 데이터 보정은 \`scripts/postprocess-news.mjs\`에 정의된 순서로 실행합니다.
`);

await write("SEARCH_KEYWORDS.md", `# 검색 키워드 관리

Google News 검색어는 아래 파일 한 곳에서만 관리합니다.

\`\`\`text
data/search-keywords.json
\`\`\`

## 수정 방법

1. \`data/search-keywords.json\`을 엽니다.
2. 주제에 맞는 그룹의 배열에 검색어를 추가하거나 삭제합니다.
3. JSON 문법을 유지합니다. 각 검색어는 큰따옴표로 감싼 문자열이며 항목 사이는 쉼표로 구분합니다.
4. 같은 검색어를 중복 입력하면 검증 workflow가 실패합니다.

## 적용 범위

- GitHub Actions의 \`Collect Iraq Weekly News\`
- 로컬 또는 수동 실행의 \`npm run collect\`

\`scripts/collect-news.mjs\`가 실행할 때 이 JSON을 직접 읽으므로 자동·수동 실행에 동일하게 반영됩니다.
`);

await write(".gitignore", `node_modules/
scripts/collect-news.expanded.mjs
`);

const obsolete = [
  "app-fixed-v20.js", "app-main.js", "category-path-ui.js", "client-side-deduplicate-news.js",
  "client-side-known-article-corrections.js", "client-side-safety-guard.js", "client-side-terminology-cleanup.js",
  "hide-untranslated-news.js", "news-card-action-fix.js", "report-font-overrides.js", "report-format-overrides.js",
  "report-human-sample-style.js", "report-no-overmerge.js", "report-ruler-overrides.js", "report-writing-cleanup.js",
  "scroll-position-guard.js", "sort-news-ui.js", "scripts/collect-news.expanded.mjs", "scripts/run-collector.mjs",
  "scripts/prepare-bismayah-priority.mjs", "scripts/prepare-evidence-first-summary.mjs", "scripts/prepare-exclude-nina.mjs",
  "scripts/prepare-expanded-weekly-collector.mjs", "scripts/prepare-human-analysis-prompt-v4.mjs",
  "scripts/prepare-report-scope-guard.mjs", "scripts/prepare-search-keywords.mjs",
  "scripts/filter-nina-contaminated-health-news.mjs",
  "scripts/apply-architecture-refactor.mjs", ".github/workflows/apply-architecture-refactor.yml"
];
for (const file of obsolete) await fs.rm(p(file), { force: true });

console.log("Architecture refactor applied. Run npm install and npm run validate before committing.");
