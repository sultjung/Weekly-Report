// Prevent unrelated selected articles from being merged into one political report item.
// This overrides the earlier related-article merger with a safer one-article-one-item renderer.
(function () {
  const esc = window.escapeHtml || ((value = "") => String(value).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])));

  function dateValue(article) {
    const d = new Date(article?.publishedAt || article?.date || 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function reportMonthDay(value) {
    const d = value instanceof Date ? value : new Date(value || 0);
    return Number.isNaN(d.getTime()) ? "-" : `${d.getMonth() + 1}.${d.getDate()}`;
  }

  function koreanReportDate(date = new Date()) {
    return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`;
  }

  function legacyShortDate(date) {
    return `΄${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}.${date.getDate()}`;
  }

  function stripFinalPeriod(text = "") {
    return String(text || "").replace(/[.。]+$/g, "").trim();
  }

  function cleanLine(value = "") {
    return String(value || "").replace(/^[-*☞·•\s]+/, "").replace(/[.。]+$/g, "").trim();
  }

  function articleMain(article) {
    if (window.reportMain) return window.reportMain(article);
    const date = reportMonthDay(article.publishedAt || article.date);
    const title = article.reportBullet || article.titleKo || article.title || "주요 동향";
    return `- ${date}, ${stripFinalPeriod(title)}.`;
  }

  function articleSubs(article) {
    const fromApp = window.reportSubs ? window.reportSubs(article) : [];
    const subs = Array.isArray(fromApp) && fromApp.length
      ? fromApp
      : (Array.isArray(article.reportSubBullets) ? article.reportSubBullets.map((x) => `* ${x}`) : []);

    const seen = new Set();
    const result = [];
    for (const raw of subs) {
      const line = cleanLine(raw);
      if (!line) continue;
      const key = line.slice(0, 90);
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(`* ${line}.`);
      if (result.length >= 2) break;
    }
    return result;
  }

  function articleImplication(article) {
    const raw = window.reportImplication ? window.reportImplication(article) : (article.reportImplication ? `☞ ${article.reportImplication}` : "");
    const line = cleanLine(raw);
    return line ? `☞ ${line}.` : "";
  }

  function selectedArticlesByCategory(articles, category) {
    return (articles || [])
      .filter((x) => x && x.category3 === category)
      .sort((a, b) => {
        const ad = dateValue(a)?.getTime() || 0;
        const bd = dateValue(b)?.getTime() || 0;
        return ad - bd || Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
      });
  }

  function renderReportItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;
    return articles.map((article) => {
      const parts = [`<p class="item">${esc(articleMain(article))}</p>`];
      for (const sub of articleSubs(article)) parts.push(`<p class="sub">${esc(sub)}</p>`);
      const implication = articleImplication(article);
      if (implication) parts.push(`<p class="implication">${esc(implication)}</p>`);
      return parts.join("");
    }).join("\n");
  }

  function resolveReportPeriod(articles) {
    const dates = (articles || []).map(dateValue).filter(Boolean).sort((a, b) => a - b);
    const today = new Date();
    if (!dates.length) {
      const end = new Date(today);
      end.setDate(end.getDate() - 1);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);
      return { start, end, reportDate: today };
    }
    return { start: dates[0], end: dates[dates.length - 1], reportDate: today };
  }

  function renderTerrorTable() {
    return `<table class="report-table"><tr><th>구분</th><th>계</th><th>무장세력공격</th><th>IED</th><th>암 살</th><th>시 위</th><th>총 격</th><th>자살폭탄테러</th></tr><tr><td>건수</td><td>확인 필요</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr></table>`;
  }

  function renderOilTable(period) {
    const d1 = new Date(period.reportDate);
    d1.setDate(d1.getDate() - 2);
    const d2 = new Date(period.reportDate);
    d2.setDate(d2.getDate() - 1);
    return `<table class="report-table oil-table"><tr><th>구 분</th><th>두바이유</th><th>브렌트유</th><th>서부텍사스유(WTI)</th></tr><tr><td>${esc(reportMonthDay(d1))}</td><td>-</td><td>-</td><td>-</td></tr><tr><td>${esc(reportMonthDay(d2))}</td><td>-</td><td>-</td><td>-</td></tr></table>`;
  }

  function textOf(article = {}) {
    return [article.titleKo, article.title, article.summaryKo, article.weeklyReportReason, article.reportImplication, ...(article.reportSubBullets || [])].filter(Boolean).join(" ");
  }

  function hasCabinetOrCom(article = {}) {
    return /내각회의|COM|Council of Ministers|مجلس الوزراء|국무회의/i.test(textOf(article));
  }

  function renderOptionalCabinetTable(politicsArticles) {
    const rows = politicsArticles.filter(hasCabinetOrCom).slice(0, 5);
    if (!rows.length) return "";
    return `<table class="report-table cabinet-table"><tr><th>구 분</th><th>주 제</th><th>내 용</th></tr>${rows.map((article, i) => `<tr><td>${i + 1}</td><td>${esc(article.titleKo || article.title || "내각회의")}</td><td class="left-cell">${esc((article.reportSubBullets || [article.summaryKo || article.weeklyReportReason || "주요 의결사항 확인 필요"]).join("\n"))}</td></tr>`).join("")}</table>`;
  }

  function buildImpactItems(articles) {
    const top = (articles || []).slice().sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0)).slice(0, 8);
    const safety = top.find((x) => x.category3 === "terror_security" || x.category3 === "regional");
    const admin = top.find((x) => x.category3 === "politics" || x.category3 === "oil_economy");
    return [
      `• ${stripFinalPeriod(safety?.reportImplication || safety?.weeklyReportReason || "이라크 치안 및 주변국 긴장 동향에 따른 현장 이동·외부활동 관리 지속 필요")}.`,
      `• ${stripFinalPeriod(admin?.reportImplication || admin?.weeklyReportReason || "정부·의회·투자기관 동향에 따른 인허가 및 사업 협의 일정 변동 가능성 점검 필요")}.`
    ];
  }

  function wordListMain(num, label) {
    return `<p class="h1 word-list-main" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${num}.<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`;
  }

  function wordListSub(num, label) {
    return `<p class="h2 word-list-sub" style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">${num})<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`;
  }

  function reportStyles() {
    return `@page WordSection1 { size: 595.3pt 841.9pt; margin: 50pt 54pt 50pt 54pt; }
 div.WordSection1 { page: WordSection1; }
 body { font-family: Batang, serif; font-size: 14pt; color: #000; }
 p { margin: 0 0 6pt 0; line-height: 1.25; }
 .title { font-size: 16pt; font-weight: bold; text-decoration: underline; margin-bottom: 8pt; }
 .date { text-align: right; margin-bottom: 18pt; }
 .h1 { font-size: 16pt; font-weight: bold; margin: 14pt 0 10pt 0; }
 .h2 { font-size: 14pt; font-weight: bold; margin: 12pt 0 8pt 28pt; }
 .category { font-size: 14pt; font-weight: bold; margin: 10pt 0 7pt 52pt; }
 .item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; }
 .sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; }
 .implication { font-style: italic; }
 .impact { margin: 7pt 0 4pt 66pt; text-indent: 8pt; }
 .empty-line { color: #555; }
 table.report-table { width: 100%; border-collapse: collapse; margin: 5pt 0 10pt 0; font-size: 11pt; }
 .report-table th, .report-table td { border: 1px solid #333; padding: 5pt; text-align: center; vertical-align: middle; }
 .report-table th { background: #f2f2f2; font-weight: bold; }
 .report-table .left-cell { text-align: left; white-space: pre-line; }
 .cabinet-table td:nth-child(1) { width: 10%; }
 .cabinet-table td:nth-child(2) { width: 30%; }
 .cabinet-table td:nth-child(3) { width: 60%; }
 .source-note { color: #666; font-size: 9pt; margin-top: 16pt; }
 @list l0 { mso-list-id:1001001; mso-list-type:hybrid; mso-list-template-ids:1001001; }
 @list l0:level1 { mso-level-number-format:decimal; mso-level-text:"%1."; mso-level-tab-stop:24pt; mso-level-number-position:left; margin-left:24pt; text-indent:-24pt; }
 @list l1 { mso-list-id:1001002; mso-list-type:hybrid; mso-list-template-ids:1001002; }
 @list l1:level1 { mso-level-number-format:decimal; mso-level-text:"%1)"; mso-level-tab-stop:56pt; mso-level-number-position:left; margin-left:56pt; text-indent:-28pt; }
 .word-list-main { font-size:16pt; font-weight:bold; margin:14pt 0 10pt 0; mso-pagination:widow-orphan; }
 .word-list-sub { font-size:14pt; font-weight:bold; margin:12pt 0 8pt 28pt; mso-pagination:widow-orphan; }`;
  }

  window.buildWordHtml = function buildWordHtmlWithoutOverMerging(articles) {
    const selected = (articles || []).filter((x) => x && x.category3 !== "exclude" && x.reportUsefulness !== "exclude");
    const period = resolveReportPeriod(selected);
    const politics = selectedArticlesByCategory(selected, "politics");
    const security = selectedArticlesByCategory(selected, "terror_security");
    const economy = selectedArticlesByCategory(selected, "oil_economy");
    const regional = selectedArticlesByCategory(selected, "regional");
    const title = `건설, 이라크 주간 종합 상황보고(${legacyShortDate(period.start)} ~ ${legacyShortDate(period.end)})`;
    const impact = buildImpactItems(selected).map((x) => `<p class="impact">${esc(x)}</p>`).join("");

    return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${reportStyles()}</style></head><body><div class="WordSection1"><p class="title">${esc(title)}</p><p class="date">${esc(koreanReportDate(period.reportDate))}</p>${wordListMain(1, "이라크 국내 상황")}${wordListSub(1, "정국 / 치안")}<p class="category">• 정치권 동향</p>${renderReportItems(politics)}${renderOptionalCabinetTable(politics)}<p class="category">• 이라크 주간 테러 상황</p>${renderTerrorTable()}${renderReportItems(security)}${wordListSub(2, "경제")}<p class="category">• 국제유가 관련 동향</p>${renderReportItems(economy)}${renderOilTable(period)}${wordListMain(2, "국제사회")}<p class="category">• 이라크와 관련 있는 주변국·국제정세</p>${renderReportItems(regional)}${wordListMain(3, "그룹 / 건설에 미치는 영향")}${impact}<p class="source-note">※ 본 보고서는 웹앱에서 사용자가 선택한 ${selected.length}건의 기사 후보를 기반으로 자동 생성됨.</p></div></body></html>`;
  };
})();
