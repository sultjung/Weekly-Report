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
