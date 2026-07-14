/**
 * Weekly-Report browser application bundle.
 *
 * The previous execution order is preserved while replacing separately loaded
 * patch files with one deployable asset.
 */


/* ===== app-fixed-v20.js ===== */
(() => {
  const state = { articles: [], filtered: [], selected: new Map(), activeCategory: "all" };
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "weekly-report-selected-v2";
  const ARABIC_RE = /[\u0600-\u06FF]/;
  const KOREAN_RE = /[가-힣]/;

  const esc = (v = "") => String(v).replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c]));
  const escAttr = esc;

  function formatDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
    return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
  }
  function dateValue(article) {
    const d = new Date(article?.publishedAt || article?.date || 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  function shortDate(value) {
    const d = new Date(value || 0);
    return Number.isNaN(d.getTime()) ? "-" : `${d.getMonth() + 1}.${d.getDate()}`;
  }
  function reportMonthDay(value) {
    const d = value instanceof Date ? value : new Date(value || 0);
    return Number.isNaN(d.getTime()) ? "-" : `${d.getMonth() + 1}.${d.getDate()}`;
  }
  function koreanReportDate(date = new Date()) { return `${date.getFullYear()}. ${date.getMonth() + 1}. ${date.getDate()}.`; }
  function legacyShortDate(date) { return `΄${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}.${date.getDate()}`; }
  function fileDateName(date = new Date()) { return `${date.getMonth() + 1}월 ${date.getDate()}일`; }
  function stripFinalPeriod(text = "") { return String(text || "").replace(/[.。]+$/g, "").trim(); }

  function simpleHash(value = "") {
    let hash = 0;
    const text = String(value || "");
    for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    return Math.abs(hash).toString(36);
  }
  function baseArticleKey(article) {
    return [article.id, article.url, article.titleKo || article.title, article.publishedAt || article.date, article.source].filter(Boolean).join("|");
  }
  function getArticleKey(article) {
    return article.__uiKey || article.selectionKey || article.id || article.url || `${article.titleKo || article.title}-${article.publishedAt}`;
  }
  function stripUiFields(article = {}) {
    const { __uiKey, selectionKey, aiCacheHit, ...rest } = article;
    return rest;
  }

  function categoryLabel(category3) {
    return { politics: "정치권 동향", terror_security: "이라크 주간 테러 상황", oil_economy: "경제 / 국제유가", regional: "국제사회", exclude: "제외/보류" }[category3] || "기타";
  }
  function textOf(article = {}) {
    return [article.titleKo, article.title, article.summaryKo, article.weeklyReportReason, article.reportBullet, ...(article.reportSubBullets || []), article.reportImplication, ...(article.actors || []), article.location, article.source].filter(Boolean).join(" ");
  }
  function isMostlyUntranslated(article = {}) {
    const title = String(article.titleKo || article.title || "");
    const summary = String(article.summaryKo || article.description || "");
    const combined = `${title}\n${summary}`;
    return ARABIC_RE.test(combined) && !KOREAN_RE.test(`${article.titleKo || ""} ${article.summaryKo || ""}`);
  }
  function categoryPath(article = {}) {
    const cat = article.category3 || "exclude";
    const text = textOf(article).toLowerCase();
    if (cat === "politics") return "1. 이라크 국내 상황 > 1) 정국 / 치안 > • 정치권 동향";
    if (cat === "terror_security") return "1. 이라크 국내 상황 > 1) 정국 / 치안 > • 이라크 주간 테러 상황";
    if (cat === "oil_economy") {
      if (/건설주택부|주거도시|환경기준|도시계획|단열재|녹지|건설자재|housing|construction/.test(text)) return "1. 이라크 국내 상황 > 2) 경제 > • 건설·주택·투자환경 동향";
      return "1. 이라크 국내 상황 > 2) 경제 > • 국제유가 관련 동향";
    }
    if (cat === "regional") {
      if (/iran|이란|israel|이스라엘|trump|트럼프|irgc|혁명수비대|호르무즈|hormuz|미군기지|us bases|바레인|bahrain|쿠웨이트|kuwait|미사일|missile|drone|드론|공습|airstrike|memorandum|양해각서/.test(text)) return "2. 국제사회 > • 美·이스라엘-이란 분쟁 관련";
      if (/sdf|sna|시리아민주군|시리아국가군|syria|시리아|튀르키예|turkey|isis camps|is 수용소|난민캠프/.test(text)) return "2. 국제사회 > • 시리아 정세 관련";
      if (/gaza|가자|hamas|하마스|hostage|인질|팔레스타인|palestine/.test(text)) return "2. 국제사회 > • 가자·하마스 관련";
      if (/houthi|후티|red sea|홍해|yemen|예멘/.test(text)) return "2. 국제사회 > • 홍해·후티 관련";
      return "2. 국제사회 > • 이라크 관련 국제정세";
    }
    return "제외/보류 > 보고서 후보 제외";
  }
  function hasValidUrl(url = "") { return /^https?:\/\//i.test(String(url || "")); }
  function humanizeTerms(text = "") {
    return String(text || "")
      .replace(/국가투자위원회/g, "NIC")
      .replace(/투자위원회/g, "NIC")
      .replace(/투자청장/g, "NIC 의장")
      .replace(/부패방지위원회/g, "청렴위원회")
      .replace(/조정프레임워크/g, "시아조정기구(SCF)")
      .replace(/이라크의?\s+정치적?\s+조정\s+기구/g, "시아조정기구(SCF)")
      .replace(/자이드\s+정부의\s+완성/g, "이라크 내각 구성")
      .replace(/자이드\s+정부/g, "Al-Zaidi 총리 내각")
      .replace(/Ali\s+Al-Zaidi\s+총리/g, "Al-Zaidi 총리")
      .replace(/바그다드/g, "Baghdad")
      .replace(/테헤란/g, "Teheran");
  }

  function loadSelection() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      state.selected = new Map(raw.map((item) => [getArticleKey(item), item]));
    } catch { state.selected = new Map(); }
  }
  function selectedPayload() {
    const articles = [...state.selected.values()].map(stripUiFields).sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
    return { generatedAt: new Date().toISOString(), purpose: "iraq-weekly-report-selected-news", count: articles.length, articles };
  }
  function saveSelection() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.selected.values()]));
    updateSelectionPreview();
    updateStats();
  }
  function updateSelectionPreview() {
    if ($("selectionPreview")) $("selectionPreview").value = JSON.stringify(selectedPayload(), null, 2);
    if ($("statSelected")) $("statSelected").textContent = state.selected.size;
  }

  function inPeriod(article, period) {
    if (period === "all") return true;
    const d = dateValue(article);
    if (!d) return true;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(period));
    return d >= cutoff;
  }
  function matchesSearch(article, query) {
    if (!query) return true;
    return textOf(article).toLowerCase().includes(query.toLowerCase());
  }
  function sortArticles(articles) {
    const mode = $("sortFilter")?.value || "latest";
    return articles.slice().sort((a, b) => {
      const ad = dateValue(a)?.getTime() || 0;
      const bd = dateValue(b)?.getTime() || 0;
      const ai = Number(a.importanceScore || 0);
      const bi = Number(b.importanceScore || 0);
      if (mode === "oldest") return ad - bd || bi - ai;
      if (mode === "importance") return bi - ai || bd - ad;
      return bd - ad || bi - ai;
    });
  }
  function applyFilters() {
    const period = $("periodFilter")?.value || "7";
    const query = $("searchInput")?.value.trim() || "";
    const selectedOnly = $("selectedOnly")?.checked || state.activeCategory === "selected";
    const hideExcluded = $("hideExcluded")?.checked;
    state.filtered = sortArticles(state.articles.filter((article) => {
      const key = getArticleKey(article);
      const cat = article.category3 || "exclude";
      if (!inPeriod(article, period)) return false;
      if (state.activeCategory !== "all" && state.activeCategory !== "selected" && cat !== state.activeCategory) return false;
      if (hideExcluded && (cat === "exclude" || article.reportUsefulness === "exclude" || isMostlyUntranslated(article))) return false;
      if (selectedOnly && !state.selected.has(key)) return false;
      if (!matchesSearch(article, query)) return false;
      return true;
    }));
    renderNews();
    updateStats();
    updateCategoryCards();
  }
  function updateStats() {
    const all = state.articles;
    if ($("statTotal")) $("statTotal").textContent = all.length;
    if ($("statPolitics")) $("statPolitics").textContent = all.filter((x) => x.category3 === "politics").length;
    if ($("statSecurity")) $("statSecurity").textContent = all.filter((x) => x.category3 === "terror_security").length;
    if ($("statEconomy")) $("statEconomy").textContent = all.filter((x) => x.category3 === "oil_economy").length;
    if ($("statRegional")) $("statRegional").textContent = all.filter((x) => x.category3 === "regional").length;
    if ($("statSelected")) $("statSelected").textContent = state.selected.size;
  }
  function updateCategoryCards() {
    document.querySelectorAll("#categoryCards .stat-card").forEach((card) => card.classList.toggle("active", card.dataset.statFilter === state.activeCategory));
  }
  function renderNews() {
    const list = $("newsList");
    if (!list) return;
    if ($("visibleCount")) $("visibleCount").textContent = `${state.filtered.length}건 표시`;
    if (!state.filtered.length) {
      list.className = "news-list empty";
      list.textContent = "표시할 뉴스가 없습니다.";
      return;
    }
    list.className = "news-list";
    list.innerHTML = state.filtered.map(renderNewsCard).join("");
  }
  function renderNewsCard(article) {
    const key = getArticleKey(article);
    const selected = state.selected.has(key);
    const cat = article.category3 || "exclude";
    const reportPreview = [article.reportBullet, ...(article.reportSubBullets || []).map((x) => `* ${x}`), article.reportImplication ? `☞ ${article.reportImplication}` : ""].filter(Boolean).join("\n");
    const url = hasValidUrl(article.url) ? article.url : "";
    return `<article class="news-card ${selected ? "selected" : ""}" data-key="${escAttr(key)}">
      <div class="news-top"><div class="news-meta"><span>${esc(article.source || "-")}</span><span>${esc(formatDate(article.publishedAt))}</span><span>중요도 ${Number(article.importanceScore || 0)}</span></div><button type="button" class="select-btn ${selected ? "on" : ""}" data-action="toggle" data-key="${escAttr(key)}">${selected ? "선택됨" : "보고서에 선택"}</button></div>
      <h3 class="news-title">${esc(article.titleKo || article.title || "제목 없음")}</h3>
      <div class="category-path-line"><b>카테고리</b> ${esc(categoryPath(article))}</div>
      <p class="news-summary">${esc(article.summaryKo || article.description || "")}</p>
      <div class="tag-row"><span class="tag ${cat}">${esc(categoryLabel(cat))}</span><span class="tag">${esc(article.reportUsefulness || "watch")}</span>${article.location ? `<span class="tag">${esc(article.location)}</span>` : ""}${(article.actors || []).slice(0, 4).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      ${article.weeklyReportReason ? `<p class="news-summary"><b>반영 사유</b> ${esc(article.weeklyReportReason)}</p>` : ""}
      ${reportPreview ? `<pre class="report-preview">${esc(reportPreview)}</pre>` : ""}
      <div class="card-actions"><button type="button" class="source-btn ${url ? "" : "disabled"}" data-action="source" data-url="${escAttr(url)}">${url ? "원문 보기" : "원문 없음"}</button><span>보고서 날짜: ${esc(shortDate(article.publishedAt))}</span></div>
    </article>`;
  }
  function updateCardSelection(card, selected) {
    if (!card) return;
    card.classList.toggle("selected", selected);
    const btn = card.querySelector("button[data-action='toggle']");
    if (btn) {
      btn.classList.toggle("on", selected);
      btn.textContent = selected ? "선택됨" : "보고서에 선택";
    }
  }
  function toggleSelectionNoRerender(key, card) {
    const y = window.scrollY;
    const article = state.articles.find((x) => getArticleKey(x) === key);
    if (!article) return;
    const nowSelected = !state.selected.has(key);
    if (nowSelected) state.selected.set(key, { ...article, selected: true, selectionKey: key });
    else state.selected.delete(key);
    updateCardSelection(card, nowSelected);
    saveSelection();
    if ($("selectedOnly")?.checked || state.activeCategory === "selected") applyFilters();
    window.requestAnimationFrame(() => window.scrollTo(0, y));
  }

  function reportMain(article) {
    let base = article.reportBullet || `${reportMonthDay(article.publishedAt)}, ${article.titleKo || article.title || "주요 동향"}`;
    base = String(base).replace(/^[-·•\s]+/, "").trim();
    if (!/^\d{1,2}\.\d{1,2},/.test(base)) base = `${reportMonthDay(article.publishedAt)}, ${base}`;
    return `- ${stripFinalPeriod(humanizeTerms(base))}.`;
  }
  function reportSubs(article) {
    const subs = Array.isArray(article.reportSubBullets) ? article.reportSubBullets : [];
    if (subs.length) return subs.slice(0, 2).map((x) => `* ${stripFinalPeriod(humanizeTerms(x))}.`);
    const summary = String(article.summaryKo || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 1);
    return summary.map((x) => `* ${stripFinalPeriod(humanizeTerms(x))}.`);
  }
  function reportImplication(article) { return article.reportImplication ? `☞ ${stripFinalPeriod(humanizeTerms(article.reportImplication))}.` : ""; }
  function selectedArticlesSorted() { return [...state.selected.values()].map(stripUiFields).sort((a, b) => (dateValue(a) || 0) - (dateValue(b) || 0)); }
  function resolveReportPeriod(articles) {
    const dates = articles.map(dateValue).filter(Boolean).sort((a, b) => a - b);
    const today = new Date();
    if (!dates.length) { const end = new Date(today); end.setDate(end.getDate() - 1); const start = new Date(end); start.setDate(start.getDate() - 6); return { start, end, reportDate: today }; }
    return { start: dates[0], end: dates[dates.length - 1], reportDate: today };
  }
  function groupByCategory(articles, category) { return articles.filter((x) => x.category3 === category).sort((a, b) => (dateValue(a) || 0) - (dateValue(b) || 0)); }
  function renderReportItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;
    return articles.map((article) => `<p class="item">${esc(reportMain(article))}</p>${reportSubs(article).map((x) => `<p class="sub">${esc(x)}</p>`).join("")}${reportImplication(article) ? `<p class="implication">${esc(reportImplication(article))}</p>` : ""}`).join("");
  }
  function renderTerrorTable() { return `<table class="report-table"><tr><th>구분</th><th>계</th><th>무장세력공격</th><th>IED</th><th>암 살</th><th>시 위</th><th>총 격</th><th>자살폭탄테러</th></tr><tr><td>건수</td><td>확인 필요</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td></tr></table>`; }
  function renderOilTable(period) { const d1 = new Date(period.reportDate); d1.setDate(d1.getDate() - 2); const d2 = new Date(period.reportDate); d2.setDate(d2.getDate() - 1); return `<table class="report-table oil-table"><tr><th>구 분</th><th>두바이유</th><th>브렌트유</th><th>서부텍사스유(WTI)</th></tr><tr><td>${esc(reportMonthDay(d1))}</td><td>-</td><td>-</td><td>-</td></tr><tr><td>${esc(reportMonthDay(d2))}</td><td>-</td><td>-</td><td>-</td></tr></table>`; }
  function buildImpactItems(articles) {
    const top = articles.slice().sort((a, b) => Number(b.importanceScore || 0) - Number(a.importanceScore || 0)).slice(0, 8);
    const safety = top.find((x) => x.category3 === "terror_security" || x.category3 === "regional");
    const admin = top.find((x) => x.category3 === "politics" || x.category3 === "oil_economy");
    return [`• ${stripFinalPeriod(humanizeTerms(safety?.reportImplication || safety?.weeklyReportReason || "이라크 치안 및 주변국 긴장 동향에 따른 현장 이동·외부활동 관리 지속 필요"))}.`, `• ${stripFinalPeriod(humanizeTerms(admin?.reportImplication || admin?.weeklyReportReason || "정부·의회·투자기관 동향에 따른 인허가 및 사업 협의 일정 변동 가능성 점검 필요"))}.`];
  }
  function hasCabinetOrCom(article = {}) { return /내각회의|COM|Council of Ministers|مجلس الوزراء|국무회의/i.test(textOf(article)); }
  function renderOptionalCabinetTable(politicsArticles) {
    const rows = politicsArticles.filter(hasCabinetOrCom).slice(0, 5);
    if (!rows.length) return "";
    return `<table class="report-table cabinet-table"><tr><th>구 분</th><th>주 제</th><th>내 용</th></tr>${rows.map((article, i) => `<tr><td>${i + 1}</td><td>${esc(article.titleKo || article.title || "내각회의")}</td><td class="left-cell">${esc((article.reportSubBullets || [article.summaryKo || article.weeklyReportReason || "주요 의결사항 확인 필요"]).join("\n"))}</td></tr>`).join("")}</table>`;
  }
  function buildWordHtml(articles) {
    const period = resolveReportPeriod(articles);
    const politics = groupByCategory(articles, "politics");
    const security = groupByCategory(articles, "terror_security");
    const economy = groupByCategory(articles, "oil_economy");
    const regional = groupByCategory(articles, "regional");
    const title = `건설, 이라크 주간 종합 상황보고(${legacyShortDate(period.start)} ~ ${legacyShortDate(period.end)})`;
    const impact = buildImpactItems(articles).map((x) => `<p class="impact">${esc(x)}</p>`).join("");
    return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>@page WordSection1 { size: 595.3pt 841.9pt; margin: 50pt 54pt 50pt 54pt; } div.WordSection1 { page: WordSection1; } body { font-family: Batang, serif; font-size: 14pt; color: #000; } p { margin: 0 0 6pt 0; line-height: 1.25; } .title { font-size: 16pt; font-weight: bold; text-decoration: underline; margin-bottom: 8pt; } .date { text-align: right; margin-bottom: 18pt; } .h1 { font-size: 16pt; font-weight: bold; margin: 14pt 0 10pt 0; } .h2 { font-size: 14pt; font-weight: bold; margin: 12pt 0 8pt 28pt; } .category { font-size: 14pt; font-weight: bold; margin: 10pt 0 7pt 42pt; } .item { margin-left: 64pt; } .sub, .implication { margin-left: 78pt; } .implication { font-style: italic; } .impact { margin-left: 42pt; } .empty-line { color: #555; } table.report-table { width: 100%; border-collapse: collapse; margin: 5pt 0 10pt 0; font-size: 11pt; } .report-table th, .report-table td { border: 1px solid #333; padding: 5pt; text-align: center; vertical-align: middle; } .report-table th { background: #f2f2f2; font-weight: bold; } .report-table .left-cell { text-align: left; white-space: pre-line; } .cabinet-table td:nth-child(1) { width: 10%; } .cabinet-table td:nth-child(2) { width: 30%; } .cabinet-table td:nth-child(3) { width: 60%; } .source-note { color: #666; font-size: 9pt; margin-top: 16pt; }</style></head><body><div class="WordSection1"><p class="title">${esc(title)}</p><p class="date">${esc(koreanReportDate(period.reportDate))}</p><p class="h1">1. 이라크 국내 상황</p><p class="h2">1) 정국 / 치안</p><p class="category">• 정치권 동향</p>${renderReportItems(politics)}${renderOptionalCabinetTable(politics)}<p class="category">• 이라크 주간 테러 상황</p>${renderTerrorTable()}${renderReportItems(security)}<p class="h2">2) 경제</p><p class="category">• 국제유가 관련 동향</p>${renderReportItems(economy)}${renderOilTable(period)}<p class="h1">2. 국제사회</p><p class="category">• 이라크와 관련 있는 주변국·국제정세</p>${renderReportItems(regional)}<p class="h1">3. 그룹 / 건설에 미치는 영향</p>${impact}<p class="source-note">※ 본 보고서는 웹앱에서 사용자가 선택한 ${articles.length}건의 기사 후보를 기반으로 자동 생성됨.</p></div></body></html>`;
  }
  function generateReportDocument() {
    const articles = selectedArticlesSorted();
    if (!articles.length) return alert("보고서에 넣을 기사를 먼저 선택해주세요.");
    const period = resolveReportPeriod(articles);
    const html = window.buildWordHtml ? window.buildWordHtml(articles) : buildWordHtml(articles);
    const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `건설_이라크 주간 종합상황보고(${fileDateName(period.reportDate)}).doc`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function loadNews() {
    loadSelection();
    try {
      const res = await fetch(`./data/news.json?v=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.articles = (Array.isArray(data.articles) ? data.articles : []).map((article, index) => ({ ...article, __uiKey: `ui-${index}-${simpleHash(baseArticleKey(article))}`, selectionKey: `ui-${index}-${simpleHash(baseArticleKey(article))}` }));
      if ($("updatedAt")) $("updatedAt").textContent = data.generatedAt ? formatDate(data.generatedAt) : "-";
    } catch (err) {
      if ($("newsList")) { $("newsList").className = "news-list empty"; $("newsList").textContent = `뉴스 데이터를 불러오지 못했습니다: ${err.message || err}`; }
    }
    updateSelectionPreview();
    applyFilters();
  }
  function setCategoryFilter(category) {
    state.activeCategory = category || "all";
    if (state.activeCategory !== "selected" && $("selectedOnly")) $("selectedOnly").checked = false;
    applyFilters();
  }
  function bindEvents() {
    ["periodFilter", "sortFilter", "searchInput", "selectedOnly", "hideExcluded"].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.addEventListener("input", applyFilters);
      el.addEventListener("change", applyFilters);
    });
    $("categoryCards")?.addEventListener("click", (event) => {
      const card = event.target.closest(".stat-card[data-stat-filter]");
      if (card) setCategoryFilter(card.dataset.statFilter);
    });
    $("resetFilters")?.addEventListener("click", () => {
      if ($("periodFilter")) $("periodFilter").value = "7";
      if ($("sortFilter")) $("sortFilter").value = "latest";
      if ($("searchInput")) $("searchInput").value = "";
      if ($("selectedOnly")) $("selectedOnly").checked = false;
      if ($("hideExcluded")) $("hideExcluded").checked = true;
      state.activeCategory = "all";
      applyFilters();
    });
    $("generateReport")?.addEventListener("click", generateReportDocument);
    $("clearSelection")?.addEventListener("click", () => { if (!confirm("선택한 기사를 모두 초기화할까요?")) return; state.selected.clear(); saveSelection(); applyFilters(); });
    $("newsList")?.addEventListener("click", (event) => {
      const selectBtn = event.target.closest("button[data-action='toggle']");
      if (selectBtn) {
        event.preventDefault();
        event.stopPropagation();
        toggleSelectionNoRerender(selectBtn.dataset.key, selectBtn.closest(".news-card"));
        return;
      }
      const sourceBtn = event.target.closest("button[data-action='source']");
      if (sourceBtn) {
        event.preventDefault();
        event.stopPropagation();
        const url = sourceBtn.dataset.url || "";
        if (!hasValidUrl(url)) return alert("원문 링크가 없는 기사입니다.");
        window.open(url, "_blank", "noopener,noreferrer");
      }
    });
  }

  window.escapeHtml = esc;
  window.reportMain = reportMain;
  window.reportSubs = reportSubs;
  window.reportImplication = reportImplication;
  window.buildWordHtml = buildWordHtml;

  bindEvents();
  loadNews();
})();


/* ===== report-format-overrides.js ===== */
// Browser-generated Word report format and article-merge tweaks.
// Keeps app.js stable while matching the human weekly report's paragraph spacing/indent feel.
// Also merges related selected articles into a single report item with follow-up bullets and analysis implications.
// Adds Word-compatible numbering/list markup for 1. / 1) section headings.
(function () {
  const originalBuildWordHtml = window.buildWordHtml;
  if (typeof originalBuildWordHtml !== "function") return;

  function textOf(article) {
    return [
      article.titleKo,
      article.title,
      article.summaryKo,
      article.weeklyReportReason,
      article.reportBullet,
      ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
      article.reportImplication,
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean).join(" ");
  }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function dateOnly(article) {
    const d = new Date(article.publishedAt || article.date || 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayDiff(a, b) {
    const ad = dateOnly(a);
    const bd = dateOnly(b);
    if (!ad || !bd) return 99;
    return Math.abs(ad - bd) / 86400000;
  }

  function tokenSet(article) {
    const text = norm(textOf(article));
    const keys = new Set();

    const candidates = [
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean);
    for (const item of candidates) {
      const cleaned = norm(item).replace(/[()\[\],.]/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned && cleaned.length >= 2) keys.add(cleaned);
    }

    const dictionary = [
      "iraq", "iran", "baghdad", "teheran", "tehran", "qom", "najaf", "karbala", "amedi", "khamenei",
      "al-zaidi", "zaidi", "al-sudani", "nouri al-maliki", "al-maliki", "al-sadr", "scf", "pmf",
      "nic", "council of ministers", "cabinet", "parliament", "integrity commission",
      "이라크", "이란", "baghdad", "teheran", "qom", "najaf", "karbala", "amedi", "khamenei", "카메네이",
      "장례식", "운구", "유해", "최고지도자", "대통령", "총리", "관계 재정립", "공식 행사",
      "시아조정기구", "청렴위원회", "내각회의", "의회", "분석", "연구소", "싱크탱크",
      "건설주택부", "주거도시", "환경기준", "도시계획", "단열재", "녹지", "자국 건설자재",
      "isis", "is", "rocket", "missile", "drone", "attack", "protest", "kidnap", "terror",
      "oil", "opec", "budget", "hormuz", "brent", "wti", "dubai"
    ];
    for (const key of dictionary) {
      if (text.includes(norm(key))) keys.add(norm(key));
    }

    return keys;
  }

  function isAnalysisArticle(article) {
    const text = norm(textOf(article));
    return /분석|연구소|싱크탱크|전문가|정치연구소|보고서|논평|관측|해석|전망|신호|관계 재정립|analyst|analysis|institute|think tank|research|expert|commentary|assessment|signal/.test(text);
  }

  function sharedTokenCount(a, b) {
    const as = tokenSet(a);
    const bs = tokenSet(b);
    let count = 0;
    for (const key of as) if (bs.has(key)) count += 1;
    return count;
  }

  function relatedScore(a, b) {
    let score = 0;
    const shared = sharedTokenCount(a, b);
    score += shared * 2;
    if (a.category3 && b.category3 && a.category3 === b.category3) score += 2;
    if (dayDiff(a, b) <= 7) score += 2;

    const combo = norm(`${textOf(a)} ${textOf(b)}`);
    const strongThemes = [
      ["khamenei", "qom"], ["khamenei", "najaf"], ["khamenei", "karbala"], ["khamenei", "teheran"], ["khamenei", "tehran"],
      ["카메네이", "qom"], ["카메네이", "najaf"], ["카메네이", "karbala"], ["카메네이", "teheran"],
      ["장례식", "운구"], ["유해", "운구"], ["공식 행사", "관계 재정립"],
      ["주거도시", "환경기준"], ["주거도시", "단열재"], ["주거도시", "녹지"], ["건설주택부", "도시계획"]
    ];
    for (const pair of strongThemes) {
      if (pair.every((x) => combo.includes(norm(x)))) score += 5;
    }
    return score;
  }

  function pickPrimary(articles) {
    const sorted = articles.slice().sort((a, b) => {
      const aa = isAnalysisArticle(a) ? 1 : 0;
      const bb = isAnalysisArticle(b) ? 1 : 0;
      if (aa !== bb) return aa - bb;
      const ad = dateOnly(a);
      const bd = dateOnly(b);
      if (ad && bd) return ad - bd;
      return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    });
    return sorted[0] || articles[0];
  }

  function articleMain(article) {
    return window.reportMain ? window.reportMain(article) : `- ${article.titleKo || article.title || "주요 동향"}.`;
  }

  function articleSubs(article) {
    if (window.reportSubs) return window.reportSubs(article);
    const summary = String(article.summaryKo || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
    return summary.map((x) => `* ${x.replace(/[.。]+$/g, "")}.`);
  }

  function articleImplication(article) {
    if (window.reportImplication) return window.reportImplication(article);
    return article.reportImplication ? `☞ ${article.reportImplication}` : "";
  }

  function clusterArticles(articles) {
    const sorted = articles.slice().sort((a, b) => {
      const ad = dateOnly(a);
      const bd = dateOnly(b);
      if (ad && bd) return ad - bd;
      return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    });

    const clusters = [];
    for (const article of sorted) {
      let best = null;
      let bestScore = 0;
      for (const cluster of clusters) {
        const score = Math.max(...cluster.articles.map((x) => relatedScore(article, x)));
        if (score > bestScore) {
          bestScore = score;
          best = cluster;
        }
      }
      if (best && bestScore >= 7) best.articles.push(article);
      else clusters.push({ articles: [article] });
    }

    return clusters.map((cluster) => {
      const primary = pickPrimary(cluster.articles);
      const related = cluster.articles.filter((x) => x !== primary);
      return { primary, related, articles: cluster.articles };
    });
  }

  function cleanLine(value) {
    return String(value || "").replace(/^[-*☞·•\s]+/, "").replace(/[.。]+$/g, "").trim();
  }

  function sourcePrefix(article) {
    const source = String(article.source || "").trim();
    if (!source) return "";
    if (/institute|research|center|centre|council|foundation|연구소|센터|재단|협회|전문가/i.test(source)) return `${source}, `;
    return "";
  }

  function renderMergedReportItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;

    return clusterArticles(articles).map((cluster) => {
      const { primary, related } = cluster;
      const normalRelated = related.filter((x) => !isAnalysisArticle(x));
      const analysisRelated = related.filter(isAnalysisArticle);
      const lines = [];

      lines.push(`<p class="item">${window.escapeHtml(articleMain(primary))}</p>`);

      const subCandidates = [
        ...articleSubs(primary),
        ...normalRelated.flatMap((article) => articleSubs(article).slice(0, 2))
      ].map(cleanLine).filter(Boolean);
      const seenSubs = new Set();
      for (const sub of subCandidates) {
        const key = sub.slice(0, 80);
        if (seenSubs.has(key)) continue;
        seenSubs.add(key);
        lines.push(`<p class="sub">${window.escapeHtml(`* ${sub}.`)}</p>`);
        if (seenSubs.size >= 4) break;
      }

      const implicationCandidates = [
        ...analysisRelated.map((article) => {
          const raw = cleanLine(articleImplication(article) || article.weeklyReportReason || article.summaryKo || article.titleKo || article.title);
          return raw ? `☞ ${sourcePrefix(article)}${raw}.` : "";
        }),
        !analysisRelated.length ? articleImplication(primary) : ""
      ].map((x) => String(x || "").trim()).filter(Boolean);

      const seenImplications = new Set();
      for (const implication of implicationCandidates) {
        const key = implication.slice(0, 100);
        if (seenImplications.has(key)) continue;
        seenImplications.add(key);
        lines.push(`<p class="implication">${window.escapeHtml(implication)}</p>`);
        if (seenImplications.size >= 2) break;
      }

      return lines.join("");
    }).join("");
  }

  function wordListMain(num, label) {
    return `<p class="h1 word-list-main" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${num}.<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`;
  }

  function wordListSub(num, label) {
    return `<p class="h2 word-list-sub" style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">${num})<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`;
  }

  function applyWordNumbering(html) {
    let out = html;

    const listStyle = `
@list l0 { mso-list-id:1001001; mso-list-type:hybrid; mso-list-template-ids:1001001; }
@list l0:level1 { mso-level-number-format:decimal; mso-level-text:"%1."; mso-level-tab-stop:24pt; mso-level-number-position:left; margin-left:24pt; text-indent:-24pt; }
@list l1 { mso-list-id:1001002; mso-list-type:hybrid; mso-list-template-ids:1001002; }
@list l1:level1 { mso-level-number-format:decimal; mso-level-text:"%1)"; mso-level-tab-stop:56pt; mso-level-number-position:left; margin-left:56pt; text-indent:-28pt; }
.word-list-main { font-size:16pt; font-weight:bold; margin:14pt 0 10pt 0; mso-pagination:widow-orphan; }
.word-list-sub { font-size:14pt; font-weight:bold; margin:12pt 0 8pt 28pt; mso-pagination:widow-orphan; }
.category { font-size:14pt; font-weight:bold; margin:10pt 0 7pt 52pt; }
.item { margin:8pt 0 5pt 76pt; text-indent:10pt; }
.sub, .implication { margin:0 0 4pt 100pt; text-indent:8pt; }
.impact { margin:7pt 0 4pt 66pt; text-indent:8pt; }`;

    out = out.replace("</style>", `${listStyle}\n</style>`);

    out = out.replace(/<p class="h1">1\. 이라크 국내 상황<\/p>/g, wordListMain(1, "이라크 국내 상황"));
    out = out.replace(/<p class="h1">2\. 국제사회<\/p>/g, wordListMain(2, "국제사회"));
    out = out.replace(/<p class="h1">3\. 그룹 \/ 건설에 미치는 영향<\/p>/g, wordListMain(3, "그룹 / 건설에 미치는 영향"));
    out = out.replace(/<p class="h2">1\) 정국 \/ 치안<\/p>/g, wordListSub(1, "정국 / 치안"));
    out = out.replace(/<p class="h2">2\) 경제<\/p>/g, wordListSub(2, "경제"));

    return out;
  }

  window.buildWordHtml = function buildWordHtmlWithMergedRelatedArticles(articles) {
    let html = originalBuildWordHtml(articles);

    const byCat = (cat) => articles.filter((x) => x.category3 === cat).sort((a, b) => (dateOnly(a) || 0) - (dateOnly(b) || 0));

    // The original buildWordHtml has already interpolated report items, so replace the content between category headings instead.
    html = html.replace(
      /(<p class="category">• 정치권 동향<\/p>)([\s\S]*?)(\s*<table class="report-table cabinet-table">|\s*<p class="category">• 이라크 주간 테러 상황<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("politics"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 이라크 주간 테러 상황<\/p>\s*[\s\S]*?<\/table>)([\s\S]*?)(\s*<p class="h2">2\) 경제<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("terror_security"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 국제유가 관련 동향<\/p>)([\s\S]*?)(\s*<table class="report-table oil-table">)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("oil_economy"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 이라크와 관련 있는 주변국·국제정세<\/p>)([\s\S]*?)(\s*<p class="h1">3\. 그룹 \/ 건설에 미치는 영향<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("regional"))}\n  ${b}`
    );

    html = html.replace(
      ".item { margin-left: 64pt; }",
      ".item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin-left: 78pt; }",
      ".sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; }"
    );
    html = html.replace(
      ".impact { margin-left: 42pt; }",
      ".impact { margin: 7pt 0 4pt 66pt; text-indent: 8pt; }"
    );
    html = html.replace(
      ".category { font-size: 14pt; font-weight: bold; margin: 10pt 0 7pt 42pt; }",
      ".category { font-size: 14pt; font-weight: bold; margin: 10pt 0 7pt 52pt; }"
    );

    return applyWordNumbering(html);
  };
})();


/* ===== report-no-overmerge.js ===== */
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


/* ===== report-font-overrides.js ===== */
// Browser-generated Word report font-size overrides.
// Main article summary lines beginning with '-' use 14pt.
// Detail lines beginning with '*' and implications beginning with '☞' use 13pt.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  window.buildWordHtml = function buildWordHtmlWithReportFontSizes(articles) {
    let html = previousBuildWordHtml(articles);

    html = html.replace(
      ".item { margin:8pt 0 5pt 76pt; text-indent:10pt; }",
      ".item { margin:8pt 0 5pt 76pt; text-indent:10pt; font-size:14pt; }"
    );
    html = html.replace(
      ".item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; }",
      ".item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; font-size: 14pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin:0 0 4pt 100pt; text-indent:8pt; }",
      ".sub, .implication { margin:0 0 4pt 100pt; text-indent:8pt; font-size:13pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; }",
      ".sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; font-size: 13pt; }"
    );

    return html;
  };
})();


/* ===== report-ruler-overrides.js ===== */
// Final browser-generated Word report ruler/indent overrides.
// Loaded last so these values win over earlier formatting patches.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  window.buildWordHtml = function buildWordHtmlWithTightHumanRuler(articles) {
    let html = previousBuildWordHtml(articles);

    const tightRulerCss = `
/* Human sample ruler alignment: 1. > 1) > • > - > * / ☞ */
@list l0 { mso-list-id:1001001; mso-list-type:hybrid; mso-list-template-ids:1001001; }
@list l0:level1 { mso-level-number-format:decimal; mso-level-text:"%1."; mso-level-tab-stop:0pt; mso-level-number-position:left; margin-left:0pt; text-indent:0pt; }
@list l1 { mso-list-id:1001002; mso-list-type:hybrid; mso-list-template-ids:1001002; }
@list l1:level1 { mso-level-number-format:decimal; mso-level-text:"%1)"; mso-level-tab-stop:18pt; mso-level-number-position:left; margin-left:18pt; text-indent:-18pt; }
p.word-list-main { font-size:16pt; font-weight:bold; margin:12pt 0 6pt 0pt; padding-left:0pt; text-indent:0pt; }
p.word-list-sub { font-size:14pt; font-weight:bold; margin:6pt 0 5pt 18pt; padding-left:0pt; text-indent:0pt; }
p.category { font-size:14pt; font-weight:bold; margin:5pt 0 4pt 34pt; padding-left:0pt; text-indent:0pt; }
p.item { margin:5pt 0 3pt 50pt; padding-left:0pt; text-indent:0pt; font-size:14pt; }
p.sub, p.implication { margin:0 0 3pt 62pt; padding-left:0pt; text-indent:0pt; font-size:13pt; }
p.impact { margin:5pt 0 3pt 42pt; padding-left:0pt; text-indent:0pt; font-size:13pt; }
`;

    html = html.replace("</style>", `${tightRulerCss}\n</style>`);
    return html;
  };
})();


/* ===== report-writing-cleanup.js ===== */
// Final browser report writing cleanup rules learned from user edits.
// Applies immediately to the downloaded Word-compatible report, even before the next news collection run.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  function applyLearnedWritingRules(html) {
    let out = String(html || "");

    const replacements = [
      [/이라크의?\s+정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
      [/정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
      [/자이드\s+정부의\s+완성/g, "이라크 내각 구성"],
      [/자이드\s+정부/g, "Al-Zaidi 총리 내각"],
      [/Ali\s+Al-Zaidi\s+총리/g, "Al-Zaidi 총리"],
      [/Al-Zaidi\s+총리\s+총리/g, "Al-Zaidi 총리"],
      [/(?:Nouri\s+)+Al-Maliki(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
      [/Nouri\s+Al-Maliki\s+총리/giu, "Nouri Al-Maliki 前 총리"],
      [/Nouri\s+Nouri\s+/giu, "Nouri "],
      [/Nouri\s+Al-Maliki\s+前\s*총리(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
      [/前\s*총리(?:\s+前\s*총리)+/giu, "前 총리"],
      [/총리(?:\s+총리)+/giu, "총리"],
      [/대규모\s*방문\s*위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문\s*최고위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
      [/아르바인\s*기념일\s*준비/g, "아르바인 순례 준비"],
      [/아르바인\s*방문\s*준비/g, "아르바인 순례 준비"]
    ];
    for (let pass = 0; pass < 5; pass += 1) {
      const before = out;
      for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);
      if (out === before) break;
    }

    out = out.replace(
      /이라크 내각 구성이 미국 방문 이후로 미뤄졌다\.\s*시아조정기구\(SCF\)(?:는|은)? 장관 임명 결정을 미국 방문 결과에 연계하고 있다\.\s*이는 정치적 불확실성을 더욱 부각시키고 있다\./g,
      "이라크 내각 구성이 Al-Zaidi 총리의 미국 방문 이후로 미뤄짐에 따라 정치적 불확실성을 더욱 부각시키고 있음."
    );

    out = out.replace(
      /-\s*(\d{1,2}\.\d{1,2}),\s*시아조정기구\(SCF\),\s*장관 임명 결정을 미국 방문 결과에 연계\.?/g,
      "- $1, 시아조정기구(SCF), 미국 방문 결과에 연계하여 장관 임명 결정."
    );

    out = out.replace(
      /<p class="implication">☞\s*부패 척결을 위한 정치적 의지가 강화될 가능성\.?<\/p>/g,
      "<p class=\"implication\">☞ 반부패 수사로 정치권 내 연정 합의가 흔들리며 내각 구성 지연 가능성 제기.</p>"
    );
    out = out.replace(
      /\s*<p class="implication">☞\s*정치적 압박이 강화될 가능성이 있다\.?<\/p>/g,
      ""
    );
    out = out.replace(
      /\s*<p class="implication">☞\s*정치적 압박 강화 가능성\.?<\/p>/g,
      ""
    );

    return out;
  }

  window.buildWordHtml = function buildWordHtmlWithLearnedWritingCleanup(articles) {
    return applyLearnedWritingRules(previousBuildWordHtml(articles));
  };
})();


/* ===== report-human-sample-style.js ===== */
// Human weekly-report sample style.
// Loaded last: adjusts the International section into theme buckets such as
// "美·이스라엘-이란 분쟁 관련", "시리아 정세 관련", "가자/하마스 관련".
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  const esc = (value) => (typeof window.escapeHtml === "function"
    ? window.escapeHtml(value)
    : String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])));

  function dateValue(article) {
    const d = new Date(article.publishedAt || article.date || 0);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function textOf(article) {
    return [
      article.titleKo,
      article.title,
      article.summaryKo,
      article.reportBullet,
      ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
      article.reportImplication,
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function themeOf(article) {
    const text = textOf(article);
    if (/iran|이란|israel|이스라엘|trump|트럼프|irgc|혁명수비대|호르무즈|hormuz|미군기지|us bases|바레인|bahrain|쿠웨이트|kuwait|미사일|missile|drone|드론|공습|airstrike|memorandum|양해각서/.test(text)) {
      return "美·이스라엘-이란 분쟁 관련";
    }
    if (/sdf|sna|시리아민주군|시리아국가군|syria|시리아|튀르키예|turkey|isis camps|is 수용소|난민캠프/.test(text)) {
      return "시리아 정세 관련";
    }
    if (/gaza|가자|hamas|하마스|hostage|인질|팔레스타인|palestine/.test(text)) {
      return "가자·하마스 관련";
    }
    if (/houthi|후티|red sea|홍해|yemen|예멘/.test(text)) {
      return "홍해·후티 관련";
    }
    return "이라크 관련 국제정세";
  }

  function renderItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;
    return articles.slice().sort((a, b) => dateValue(a) - dateValue(b)).map((article) => {
      const main = typeof window.reportMain === "function" ? window.reportMain(article) : `- ${article.titleKo || article.title || "주요 동향"}.`;
      const subs = typeof window.reportSubs === "function" ? window.reportSubs(article) : [];
      const implication = typeof window.reportImplication === "function" ? window.reportImplication(article) : "";
      return [
        `<p class="item">${esc(main)}</p>`,
        ...subs.map((x) => `<p class="sub">${esc(x)}</p>`),
        implication ? `<p class="implication">${esc(implication)}</p>` : ""
      ].filter(Boolean).join("");
    }).join("");
  }

  function renderInternationalByTheme(articles) {
    const regional = articles.filter((x) => x.category3 === "regional");
    if (!regional.length) return `<p class="category">• 이라크 관련 국제정세</p><p class="item empty-line">- 특이사항 없음</p>`;

    const order = [
      "美·이스라엘-이란 분쟁 관련",
      "시리아 정세 관련",
      "가자·하마스 관련",
      "홍해·후티 관련",
      "이라크 관련 국제정세"
    ];
    const grouped = new Map(order.map((x) => [x, []]));
    for (const article of regional) grouped.get(themeOf(article)).push(article);

    return order
      .filter((theme) => grouped.get(theme).length)
      .map((theme) => `<p class="category">• ${esc(theme)}</p>\n${renderItems(grouped.get(theme))}`)
      .join("\n");
  }

  window.buildWordHtml = function buildWordHtmlWithHumanSampleSections(articles) {
    let html = previousBuildWordHtml(articles);
    const themedInternational = renderInternationalByTheme(articles);

    html = html.replace(
      /(<p[^>]*class="h1[^\"]*"[^>]*>[\s\S]*?국제사회<\/p>)([\s\S]*?)(\s*<p[^>]*class="h1[^\"]*"[^>]*>[\s\S]*?그룹\s*\/\s*건설에 미치는 영향[\s\S]*?<\/p>)/,
      (_m, intro, _oldBlock, nextHeading) => `${intro}\n${themedInternational}\n${nextHeading}`
    );

    return html;
  };
})();


/* ===== client-side-safety-guard.js ===== */
// Client-side safety guard for already-generated mistranslated news data.
// This hides high-risk cards that may remain in data/news.json until the next collection run.
(function () {
  const BAD_PATTERNS = [
    /이란\s*방송[\s\S]*?(?:Baghdad|바그다드)[\s\S]*?폭발/i,
    /(?:Baghdad|바그다드)에서\s*여러\s*지역에서\s*폭발/i,
    /이란\s*방송[\s\S]*?내각\s*구성[\s\S]*?의회\s*활동/i,
    /이란\s*방송[\s\S]*?Al-Zaidi\s*총리/i,
    /Key=1305445/i,

    // NINA Najaf local-government story hallucinated into an Al-Zaidi/cabinet/parliament item.
    /Al-Zaidi\s*총리[\s\S]*?나자프\s*주지사[\s\S]*?(?:내각\s*구성|의회\s*활동|정치적\s*맥락)/i,
    /나자프\s*주지사[\s\S]*?정부\s*관계자[\s\S]*?Al-Zaidi\s*총리/i,
    /Al-Zaidi\s*총리[\s\S]*?지방\s*정부의\s*서비스\s*및\s*행정\s*역할/i,
    /성스러운\s*알라위\s*성지[\s\S]*?나자프\s*주지사/i,
    /Yusuf\s*Kanawi|유수프\s*카나위|يوسف\s*كناوي/i,

    // NINA Zurbatiya/Arbaeen local service-preparation story hallucinated into an Al-Zaidi/cabinet/parliament item.
    /Key=1305425/i,
    /Zurbatiya[\s\S]*?(?:아르바인|Arbaeen|순례|방문\s*준비)[\s\S]*?Al-Zaidi\s*총리/i,
    /Al-Zaidi\s*총리[\s\S]*?(?:아르바인|Arbaeen|순례|방문\s*준비)[\s\S]*?(?:내각\s*구성|의회|정치적\s*불확실성)/i,
    /Zurbatiya[\s\S]*?(?:내각\s*구성|의회\s*본회의|이라크\s*의회)[\s\S]*?Al-Zaidi\s*총리/i,
    /Dijla\s*및\s*Euphrates\s*강의\s*오염/i,

    // NINA foreign health/general news, especially Congo/Ebola, contaminated by sidebar politics links.
    /Key=1305453/i,
    /에볼라[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|지방\s*정부)/i,
    /콩고[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|지방\s*정부)/i,
    /알리\s*파흘[\s\S]*?Al-Zaidi\s*총리[\s\S]*?지방\s*정부의\s*역할/i,
    /Al-Zaidi\s*총리[\s\S]*?지방\s*정부의\s*역할\s*강조[\s\S]*?(?:내각|의회\s*본회의)/i,

    // NINA Hajj/Umrah electronic lottery notice hallucinated into an Al-Zaidi/cabinet/parliament item.
    /Key=1305421/i,
    /전자\s*하즈\s*추첨[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|지방\s*정부)/i,
    /하지[\s\S]*?전자\s*추첨[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|지방\s*정부)/i,
    /하즈\s*위원회[\s\S]*?전자\s*하즈\s*추첨[\s\S]*?Al-Zaidi\s*총리/i,
    /내일\s*전자\s*하즈\s*추첨\s*신청\s*시작[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|정치적\s*맥락)/i
  ];

  function isCriticalBadText(text) {
    return BAD_PATTERNS.some((re) => re.test(String(text || "")));
  }

  function cleanBadSelections() {
    try {
      const key = "weekly-report-selected-v2";
      const raw = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(raw)) return;
      const cleaned = raw.filter((item) => !isCriticalBadText(JSON.stringify(item || {})));
      if (cleaned.length !== raw.length) {
        localStorage.setItem(key, JSON.stringify(cleaned));
      }
    } catch {}
  }

  function applyGuard() {
    const list = document.getElementById("newsList");
    if (!list) return;
    let hidden = 0;
    list.querySelectorAll(".news-card").forEach((card) => {
      const text = card.textContent || "";
      if (!isCriticalBadText(text)) return;
      card.dataset.safetyHidden = "true";
      card.style.display = "none";
      hidden += 1;
    });

    const visibleCount = document.getElementById("visibleCount");
    if (visibleCount && hidden) {
      const visible = Array.from(list.querySelectorAll(".news-card")).filter((card) => card.style.display !== "none").length;
      visibleCount.textContent = `${visible}건 표시`;
    }
  }

  function schedule() {
    cleanBadSelections();
    requestAnimationFrame(() => requestAnimationFrame(applyGuard));
  }

  window.addEventListener("DOMContentLoaded", () => {
    cleanBadSelections();
    const list = document.getElementById("newsList");
    if (list) new MutationObserver(schedule).observe(list, { childList: true, subtree: true });
    schedule();
  });
})();


/* ===== client-side-terminology-cleanup.js ===== */
// Client-side terminology cleanup for already-generated news cards.
// This only changes display text until the next collection run applies the glossary to data/news.json.
(function () {
  const RULES = [
    // Recursive glossary artifacts.
    [/(?:Nouri\s+)+Al-Maliki(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
    [/Nouri\s+Al-Maliki\s+총리/giu, "Nouri Al-Maliki 前 총리"],
    [/Nouri\s+Nouri\s+/giu, "Nouri "],
    [/Nouri\s+Al-Maliki\s+前\s*총리(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
    [/前\s*총리(?:\s+前\s*총리)+/giu, "前 총리"],
    [/총리(?:\s+총리)+/giu, "총리"],
    [/Al-Zaidi\s+총리(?:\s+총리)+/giu, "Al-Zaidi 총리"],
    [/Al-Sudani\s+前\s*총리(?:\s+前\s*총리)+/giu, "Al-Sudani 前 총리"],

    // Arbaeen pilgrimage terminology.
    [/대규모\s*방문\s*위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/대규모\s*방문위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/대규모\s*방문\s*최고위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/대규모\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
    [/백만\s*방문\s*위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/백만\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
    [/아르바인\s*기념일\s*준비/g, "아르바인 순례 준비"],
    [/아르바인\s*방문\s*준비/g, "아르바인 순례 준비"]
  ];

  function cleanupText(value) {
    let out = String(value || "");
    for (let pass = 0; pass < 5; pass += 1) {
      const before = out;
      for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
      if (out === before) break;
    }
    return out;
  }

  function cleanNode(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const next = cleanupText(node.nodeValue);
      if (next !== node.nodeValue) node.nodeValue = next;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT"].includes(node.tagName)) return;
    node.childNodes.forEach(cleanNode);
  }

  function apply() {
    document.querySelectorAll(".news-card, #selectionPreview").forEach(cleanNode);
  }

  function schedule() {
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }

  window.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("newsList");
    if (list) new MutationObserver(schedule).observe(list, { childList: true, subtree: true });
    schedule();
  });
})();


/* ===== client-side-known-article-corrections.js ===== */
// Client-side corrections for known high-value articles already present in data/news.json.
// This updates visible cards until the next collection run rewrites data/news.json.
(function () {
  function canonicalUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      let path = u.pathname.replace(/\/+$/g, "");
      const m = path.match(/\/(\d+)$/);
      if (host.includes("964media.com") && m) path = `/${m[1]}`;
      return `${host}${path}`.toLowerCase();
    } catch {
      return raw.toLowerCase().replace(/[?#].*$/g, "").replace(/\/+$/g, "");
    }
  }

  function isMalikiCard(card) {
    const sourceBtn = card.querySelector("button[data-url]");
    const url = canonicalUrl(sourceBtn?.dataset?.url || "");
    // Do not broadly rewrite every Maliki card. This correction is only for the known 964media article.
    return url === "964media.com/696180";
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function correctMalikiCard(card) {
    if (!card || card.dataset.knownArticleCorrected === "true") return;
    const title = card.querySelector(".news-title");
    setText(title, "Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 前 정부 부패 비판");

    const summaries = card.querySelectorAll("p.news-summary");
    if (summaries[0]) {
      summaries[0].textContent = "Nouri Al-Maliki 前 총리는 언론 인터뷰에서 Al-Sudani 前 총리 정부 시기 부패가 약탈 수준으로 확대되었다고 강하게 비판. 전력·항만 등 주요 부문에서 부패가 심각하게 확산되었다고 주장하는 한편, Al-Zaidi 총리의 반부패 체포·압수수색 작전을 정치 신뢰 회복을 위한 충격요법으로 평가. 다만 반부패 작전은 법적 절차와 제도적 기준 안에서 지속되어야 한다고 조건 제시.";
    }
    if (summaries[1]) {
      summaries[1].innerHTML = "<b>반영 사유</b> Al-Maliki 前 총리의 Al-Zaidi 총리 반부패 공세 공개 지지와 前 정부 부패 비판은 신임 총리의 부패척결 드라이브 및 시아 정치권 내부 역학 파악에 중요.";
    }

    const preview = card.querySelector(".report-preview");
    if (preview) {
      preview.textContent = [
        "7.7, Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 Al-Sudani 前 총리 정부 시기 부패 강력 비판",
        "* Al-Maliki 前 총리, 전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었으며 전력·항만 등 주요 부문에서 확산되었다고 주장.",
        "* Al-Zaidi 총리의 체포·압수수색 등 반부패 작전은 국민 신뢰 회복을 위한 충격요법으로 평가.",
        "* 다만 반부패 작전은 법적 절차와 제도적 기준, 정치적 통제 안에서 지속되어야 한다고 조건 제시.",
        "☞ Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석."
      ].join("\n");
    }

    card.dataset.knownArticleCorrected = "true";
  }

  function apply() {
    document.querySelectorAll(".news-card").forEach((card) => {
      if (isMalikiCard(card)) correctMalikiCard(card);
    });
  }

  function schedule() {
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }

  window.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("newsList");
    if (list) new MutationObserver(schedule).observe(list, { childList: true, subtree: true });
    schedule();
  });
})();


/* ===== client-side-deduplicate-news.js ===== */
// Client-side duplicate guard for already-generated news cards.
// The real fix is scripts/deduplicate-news-articles.mjs during collection;
// this only hides duplicate cards that are already present in data/news.json.
(function () {
  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/["'“”‘’.,،؛:：()\[\]{}<>]/g, "")
      .trim();
  }

  function canonicalUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw);
      const host = u.hostname.replace(/^www\./i, "").toLowerCase();
      let pathname = u.pathname.replace(/\/+$/g, "");
      if (host.includes("964media.com")) {
        const m = pathname.match(/\/(\d+)$/);
        if (m) pathname = `/${m[1]}`;
      }
      if (host.includes("ninanews.com")) {
        const key = u.searchParams.get("Key") || u.searchParams.get("key");
        if (key) return `${host}/website/news/details?key=${key}`;
      }
      return `${host}${pathname}`.toLowerCase();
    } catch {
      return raw.toLowerCase().replace(/[?#].*$/g, "").replace(/\/+$/g, "");
    }
  }

  function isMalikiAntiCorruptionDuplicate(text) {
    const x = normalize(text);
    return /(?:nouri\s*)?al[- ]?maliki|말리키/.test(x)
      && /al[- ]?zaidi|자이디|반부패/.test(x)
      && /al[- ]?sudani|前\s*정부|전\s*정부|약탈|부패/.test(x)
      && /반부패|corruption|부패/.test(x);
  }

  function signature(card) {
    const allText = card.textContent || "";

    // Content-level known duplicates must be checked before URL.
    // The same story can be collected through different URLs, dates, or caches.
    if (isMalikiAntiCorruptionDuplicate(allText)) {
      return "known:maliki-anti-corruption-interview";
    }

    const sourceBtn = card.querySelector("button[data-url]");
    const url = canonicalUrl(sourceBtn?.dataset?.url || "");
    if (url) return `url:${url}`;

    const source = normalize(card.querySelector(".news-meta span")?.textContent || "");
    const title = normalize(card.querySelector(".news-title")?.textContent || "");
    const previewFirstLine = normalize((card.querySelector(".report-preview")?.textContent || "").split("\n")[0] || "");

    if (source && title && previewFirstLine) return `content:${source}|${title}|${previewFirstLine}`;
    return `loose:${source}|${title}`;
  }

  function cardTime(card) {
    const meta = Array.from(card.querySelectorAll(".news-meta span")).map((x) => x.textContent || "").join(" ");
    const m = meta.match(/(\d{4})\.\s*(\d{2})\.\s*(\d{2})/);
    if (!m) return Number.POSITIVE_INFINITY;
    return new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`).getTime();
  }

  function hasSourceUrl(card) {
    const sourceBtn = card.querySelector("button[data-url]");
    return /^https?:\/\//i.test(sourceBtn?.dataset?.url || "");
  }

  function pickKeeper(cards) {
    return cards.slice().sort((a, b) => {
      // For known duplicate news, keep the earliest source date.
      const at = cardTime(a);
      const bt = cardTime(b);
      if (at !== bt) return at - bt;
      // If same day, keep a card with a valid source URL.
      if (hasSourceUrl(a) !== hasSourceUrl(b)) return hasSourceUrl(a) ? -1 : 1;
      return 0;
    })[0];
  }

  function apply() {
    const list = document.getElementById("newsList");
    if (!list) return;
    const groups = new Map();
    list.querySelectorAll(".news-card").forEach((card) => {
      // Reset display in case filters rerendered the list.
      if (card.dataset.duplicateHidden === "true") {
        card.dataset.duplicateHidden = "false";
        card.style.display = "";
      }
      const sig = signature(card);
      if (!groups.has(sig)) groups.set(sig, []);
      groups.get(sig).push(card);
    });

    let hidden = 0;
    for (const cards of groups.values()) {
      if (cards.length <= 1) continue;
      const keeper = pickKeeper(cards);
      cards.forEach((card) => {
        if (card === keeper) return;
        card.dataset.duplicateHidden = "true";
        card.style.display = "none";
        hidden += 1;
      });
    }

    const visibleCount = document.getElementById("visibleCount");
    if (visibleCount) {
      const visible = Array.from(list.querySelectorAll(".news-card")).filter((card) => card.style.display !== "none").length;
      visibleCount.textContent = `${visible}건 표시`;
    }
  }

  function schedule() {
    requestAnimationFrame(() => requestAnimationFrame(apply));
  }

  window.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("newsList");
    if (list) new MutationObserver(schedule).observe(list, { childList: true, subtree: true });
    schedule();
  });
})();
