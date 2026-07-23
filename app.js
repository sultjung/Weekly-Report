/** Weekly-Report browser application. */
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
  const TERM_RULES = [
    [/국가투자위원회/g, "NIC"], [/투자위원회/g, "NIC"], [/투자청장/g, "NIC 의장"],
    [/부패방지위원회/g, "청렴위원회"], [/조정프레임워크/g, "시아조정기구(SCF)"],
    [/이라크의?\s+정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
    [/정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
    [/자이드\s+정부의\s+완성/g, "이라크 내각 구성"], [/자이드\s+정부/g, "Al-Zaidi 총리 내각"],
    [/Ali\s+Al-Zaidi\s+총리/g, "Al-Zaidi 총리"],
    [/(?:Nouri\s+)+Al-Maliki(?:\s+前\s*총리)+/giu, "Nouri Al-Maliki 前 총리"],
    [/Nouri\s+Al-Maliki\s+총리/giu, "Nouri Al-Maliki 前 총리"], [/Nouri\s+Nouri\s+/giu, "Nouri "],
    [/前\s*총리(?:\s+前\s*총리)+/giu, "前 총리"], [/총리(?:\s+총리)+/giu, "총리"],
    [/대규모\s*방문\s*(?:최고)?위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/대규모\s*방문위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/대규모\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
    [/백만\s*방문\s*위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
    [/백만\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
    [/아르바인\s*(?:기념일|방문)\s*준비/g, "아르바인 순례 준비"],
    [/바그다드/g, "Baghdad"], [/테헤란/g, "Teheran"]
  ];

  const BAD_ARTICLE_PATTERNS = [
    /이란\s*방송[\s\S]*?(?:Baghdad|바그다드)[\s\S]*?폭발/i,
    /이란\s*방송[\s\S]*?(?:내각\s*구성|Al-Zaidi\s*총리)/i,
    /Key=1305445|Key=1305425|Key=1305453|Key=1305421/i,
    /Al-Zaidi\s*총리[\s\S]*?나자프\s*주지사[\s\S]*?(?:내각|의회|정치적)/i,
    /성스러운\s*알라위\s*성지[\s\S]*?나자프\s*주지사|Yusuf\s*Kanawi|유수프\s*카나위|يوسف\s*كناوي/i,
    /Zurbatiya[\s\S]*?(?:아르바인|Arbaeen|순례)[\s\S]*?Al-Zaidi\s*총리/i,
    /Dijla\s*및\s*Euphrates\s*강의\s*오염/i,
    /(?:에볼라|콩고)[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|지방\s*정부)/i,
    /전자\s*하즈\s*추첨[\s\S]*?(?:Al-Zaidi\s*총리|내각|의회|정치적)/i
  ];

  function humanizeTerms(text = "") {
    let output = String(text || "");
    for (let pass = 0; pass < 5; pass += 1) {
      const before = output;
      for (const [pattern, replacement] of TERM_RULES) output = output.replace(pattern, replacement);
      if (before === output) break;
    }
    return output;
  }

  function canonicalUrl(url = "") {
    try {
      const parsed = new URL(String(url || "").trim());
      const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
      if (host.includes("ninanews.com")) {
        const key = parsed.searchParams.get("Key") || parsed.searchParams.get("key");
        if (key) return `${host}/website/news/details?key=${key}`;
      }
      const id = parsed.pathname.match(/\/(\d+)\/?$/)?.[1];
      const pathname = host.includes("964media.com") && id ? `/${id}` : parsed.pathname.replace(/\/+$/g, "");
      return `${host}${pathname}`.toLowerCase();
    } catch {
      return String(url || "").toLowerCase().replace(/[?#].*$/g, "").replace(/\/+$/g, "");
    }
  }

  function normalizeArticle(article = {}) {
    const normalized = { ...article };
    for (const key of ["titleKo", "summaryKo", "weeklyReportReason", "reportBullet", "reportImplication", "location"]) {
      if (normalized[key]) normalized[key] = humanizeTerms(normalized[key]);
    }
    normalized.reportSubBullets = (normalized.reportSubBullets || []).map(humanizeTerms);
    normalized.actors = (normalized.actors || []).map(humanizeTerms);

    if (canonicalUrl(normalized.url) === "964media.com/696180") {
      Object.assign(normalized, {
        titleKo: "Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 前 정부 부패 비판",
        summaryKo: "Nouri Al-Maliki 前 총리는 Al-Sudani 前 총리 정부 시기 부패가 전력·항만 등 주요 부문에서 약탈 수준으로 확대되었다고 비판. Al-Zaidi 총리의 체포·압수수색 작전을 국민 신뢰 회복을 위한 충격요법으로 평가하면서도 법적 절차와 제도적 기준 내 진행 필요성 제시.",
        weeklyReportReason: "Al-Maliki 前 총리의 Al-Zaidi 총리 반부패 공세 공개 지지와 前 정부 부패 비판은 신임 총리의 부패척결 드라이브 및 시아 정치권 내부 역학 파악에 중요.",
        reportBullet: "7.7, Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 Al-Sudani 前 총리 정부 시기 부패 강력 비판",
        reportSubBullets: [
          "전 정부 시기 부패가 전력·항만 등 주요 부문에서 약탈 수준으로 확대되었다고 주장",
          "Al-Zaidi 총리의 체포·압수수색 등 반부패 작전을 국민 신뢰 회복을 위한 충격요법으로 평가",
          "반부패 작전은 법적 절차와 제도적 기준 안에서 지속되어야 한다고 조건 제시"
        ],
        reportImplication: "Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에 수사 범위 확대에 대비한 정치적 방어선 설정으로 해석."
      });
    }
    return normalized;
  }

  function duplicateSignature(article = {}) {
    const text = textOf(article).toLowerCase();
    if (/(?:al[- ]?maliki|말리키)/i.test(text) && /(?:al[- ]?zaidi|자이디|반부패)/i.test(text) && /(?:al[- ]?sudani|前\s*정부|전\s*정부|약탈|부패)/i.test(text)) {
      return "known:maliki-anti-corruption-interview";
    }
    const url = canonicalUrl(article.url);
    if (url) return `url:${url}`;
    const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, " ").replace(/["'“”‘’.,،؛:：()[\]{}<>]/g, "").trim();
    return `content:${norm(article.source)}|${norm(article.titleKo || article.title)}|${norm(article.reportBullet)}`;
  }

  function prepareArticles(articles = []) {
    const groups = new Map();
    for (const raw of articles) {
      const article = normalizeArticle(raw);
      if (BAD_ARTICLE_PATTERNS.some((pattern) => pattern.test(JSON.stringify(article)))) continue;
      const signature = duplicateSignature(article);
      const current = groups.get(signature);
      if (!current) groups.set(signature, article);
      else if (new Date(article.publishedAt || 0) < new Date(current.publishedAt || 0)) groups.set(signature, article);
    }
    return [...groups.values()];
  }

  function loadSelection() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      state.selected = new Map(prepareArticles(raw).map((item) => [getArticleKey(item), item]));
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
    const eventSources = Array.isArray(article.eventSources) ? article.eventSources.filter((item) => hasValidUrl(item.url)) : [];
    const sourceLinks = eventSources.length > 1
      ? `<div class="event-sources"><b>동일 사건 원문 ${eventSources.length}건</b>${eventSources.map((item) => `<a href="${escAttr(item.url)}" target="_blank" rel="noopener noreferrer">${esc(item.source || "원문")}</a>`).join("")}</div>`
      : "";
    return `<article class="news-card ${selected ? "selected" : ""}" data-key="${escAttr(key)}">
      <div class="news-top"><div class="news-meta"><span>${esc(article.source || "-")}</span><span>${esc(formatDate(article.publishedAt))}</span><span>중요도 ${Number(article.importanceScore || 0)}</span>${Number(article.eventArticleCount || 1) > 1 ? `<span>동일 사건 ${Number(article.eventArticleCount)}건</span>` : ""}</div><button type="button" class="select-btn ${selected ? "on" : ""}" data-action="toggle" data-key="${escAttr(key)}">${selected ? "선택됨" : "보고서에 선택"}</button></div>
      <h3 class="news-title">${esc(article.titleKo || article.title || "제목 없음")}</h3>
      <div class="category-path-line"><b>카테고리</b> ${esc(categoryPath(article))}</div>
      <p class="news-summary">${esc(article.summaryKo || article.description || "")}</p>
      <div class="tag-row"><span class="tag ${cat}">${esc(categoryLabel(cat))}</span><span class="tag">${esc(article.reportUsefulness || "watch")}</span>${article.location ? `<span class="tag">${esc(article.location)}</span>` : ""}${(article.actors || []).slice(0, 4).map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>
      ${article.weeklyReportReason ? `<p class="news-summary"><b>반영 사유</b> ${esc(article.weeklyReportReason)}</p>` : ""}
      ${reportPreview ? `<pre class="report-preview">${esc(reportPreview)}</pre>` : ""}
      <div class="card-actions"><button type="button" class="source-btn ${url ? "" : "disabled"}" data-action="source" data-url="${escAttr(url)}">${url ? "대표 원문 보기" : "원문 없음"}</button><span>보고서 날짜: ${esc(shortDate(article.publishedAt))}</span></div>${sourceLinks}
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
    const comprehensive = /주요 의결|종합 발표|내각회의|국무회의|공동성명|정례 브리핑/i.test(textOf(article));
    if (subs.length) return subs.slice(0, comprehensive ? 5 : 2).map((x) => `* ${stripFinalPeriod(humanizeTerms(x))}.`);
    const summary = String(article.summaryKo || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 1);
    return summary.map((x) => `* ${stripFinalPeriod(humanizeTerms(x))}.`);
  }
  function reportImplication(article) {
    const implication = stripFinalPeriod(humanizeTerms(article.reportImplication || ""));
    if (!implication || /^(?:부패 척결을 위한 )?정치적 (?:압박|의지).*가능성|주목 필요|신뢰 회복.*가능성/i.test(implication)) return "";
    return `☞ ${implication}.`;
  }
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
  function wordListMain(num, label) { return `<p class="h1 word-list-main" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">${num}.<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`; }
  function wordListSub(num, label) { return `<p class="h2 word-list-sub" style="mso-list:l1 level1 lfo2"><span style="mso-list:Ignore">${num})<span style="font:7.0pt 'Times New Roman'">&nbsp;&nbsp;</span></span>${label}</p>`; }
  function reportStyles() {
    return `@page WordSection1 { size:595.3pt 841.9pt; margin:50pt 54pt; }
div.WordSection1 { page:WordSection1; }
body { font-family:Batang,serif; font-size:14pt; color:#000; }
p { margin:0 0 6pt; line-height:1.25; }
.title { font-size:16pt; font-weight:bold; text-decoration:underline; margin-bottom:8pt; }
.date { text-align:right; margin-bottom:18pt; }
.h1 { font-size:16pt; font-weight:bold; } .h2,.category { font-size:14pt; font-weight:bold; }
.word-list-main { margin:12pt 0 6pt; text-indent:0; } .word-list-sub { margin:6pt 0 5pt 18pt; text-indent:0; }
.category { margin:5pt 0 4pt 34pt; } .item { margin:5pt 0 3pt 50pt; font-size:14pt; }
.sub,.implication { margin:0 0 3pt 62pt; font-size:13pt; } .implication { font-style:italic; }
.impact { margin:5pt 0 3pt 42pt; font-size:13pt; } .empty-line { color:#555; }
table.report-table { width:100%; border-collapse:collapse; margin:5pt 0 10pt; font-size:11pt; }
.report-table th,.report-table td { border:1px solid #333; padding:5pt; text-align:center; vertical-align:middle; }
.report-table th { background:#f2f2f2; font-weight:bold; } .report-table .left-cell { text-align:left; white-space:pre-line; }
.cabinet-table td:nth-child(1) { width:10%; } .cabinet-table td:nth-child(2) { width:30%; } .cabinet-table td:nth-child(3) { width:60%; }
.source-note { color:#666; font-size:9pt; margin-top:16pt; }
@list l0 { mso-list-id:1001001; mso-list-type:hybrid; } @list l0:level1 { mso-level-number-format:decimal; mso-level-text:"%1."; margin-left:0; text-indent:0; }
@list l1 { mso-list-id:1001002; mso-list-type:hybrid; } @list l1:level1 { mso-level-number-format:decimal; mso-level-text:"%1)"; margin-left:18pt; text-indent:-18pt; }`;
  }
  function internationalTheme(article) {
    const text = textOf(article).toLowerCase();
    if (/iran|이란|israel|이스라엘|trump|트럼프|irgc|혁명수비대|호르무즈|hormuz|미군기지|바레인|쿠웨이트|미사일|missile|drone|드론|공습|airstrike|양해각서/.test(text)) return "美·이스라엘-이란 분쟁 관련";
    if (/sdf|sna|시리아민주군|시리아국가군|syria|시리아|튀르키예|turkey|is 수용소|난민캠프/.test(text)) return "시리아 정세 관련";
    if (/gaza|가자|hamas|하마스|hostage|인질|팔레스타인|palestine/.test(text)) return "가자·하마스 관련";
    if (/houthi|후티|red sea|홍해|yemen|예멘/.test(text)) return "홍해·후티 관련";
    return "이라크 관련 국제정세";
  }
  function renderInternational(articles) {
    const order = ["美·이스라엘-이란 분쟁 관련", "시리아 정세 관련", "가자·하마스 관련", "홍해·후티 관련", "이라크 관련 국제정세"];
    if (!articles.length) return `<p class="category">• 이라크 관련 국제정세</p><p class="item empty-line">- 특이사항 없음</p>`;
    return order.map((theme) => [theme, articles.filter((article) => internationalTheme(article) === theme)])
      .filter(([, items]) => items.length)
      .map(([theme, items]) => `<p class="category">• ${esc(theme)}</p>${renderReportItems(items)}`).join("");
  }
  function applyLearnedWritingRules(html) {
    return String(html || "")
      .replace(/이라크 내각 구성이 미국 방문 이후로 미뤄졌다\.\s*시아조정기구\(SCF\)(?:는|은)? 장관 임명 결정을 미국 방문 결과에 연계하고 있다\.\s*이는 정치적 불확실성을 더욱 부각시키고 있다\./g, "이라크 내각 구성이 Al-Zaidi 총리의 미국 방문 이후로 미뤄짐에 따라 정치적 불확실성을 더욱 부각시키고 있음.")
      .replace(/-\s*(\d{1,2}\.\d{1,2}),\s*시아조정기구\(SCF\),\s*장관 임명 결정을 미국 방문 결과에 연계\.?/g, "- $1, 시아조정기구(SCF), 미국 방문 결과에 연계하여 장관 임명 결정.");
  }
  function buildWordHtml(articles) {
    const selected = prepareArticles(articles).filter((article) => article.category3 !== "exclude" && article.reportUsefulness !== "exclude");
    const period = resolveReportPeriod(selected);
    const politics = groupByCategory(selected, "politics");
    const security = groupByCategory(selected, "terror_security");
    const economy = groupByCategory(selected, "oil_economy");
    const regional = groupByCategory(selected, "regional");
    const title = `건설, 이라크 주간 종합 상황보고(${legacyShortDate(period.start)} ~ ${legacyShortDate(period.end)})`;
    const impact = buildImpactItems(selected).map((x) => `<p class="impact">${esc(x)}</p>`).join("");
    const html = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${reportStyles()}</style></head><body><div class="WordSection1"><p class="title">${esc(title)}</p><p class="date">${esc(koreanReportDate(period.reportDate))}</p>${wordListMain(1, "이라크 국내 상황")}${wordListSub(1, "정국 / 치안")}<p class="category">• 정치권 동향</p>${renderReportItems(politics)}${renderOptionalCabinetTable(politics)}<p class="category">• 이라크 주간 테러 상황</p>${renderTerrorTable()}${renderReportItems(security)}${wordListSub(2, "경제")}<p class="category">• 국제유가 관련 동향</p>${renderReportItems(economy)}${renderOilTable(period)}${wordListMain(2, "국제사회")}${renderInternational(regional)}${wordListMain(3, "그룹 / 건설에 미치는 영향")}${impact}<p class="source-note">※ 본 보고서는 웹앱에서 사용자가 선택한 ${selected.length}건의 기사 후보를 기반으로 자동 생성됨.</p></div></body></html>`;
    return applyLearnedWritingRules(html);
  }
  function generateReportDocument() {
    const articles = selectedArticlesSorted();
    if (!articles.length) return alert("보고서에 넣을 기사를 먼저 선택해주세요.");
    const period = resolveReportPeriod(articles);
    const html = buildWordHtml(articles);
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
      // Use the stable URL first. A unique timestamp during a GitHub Pages
      // deployment can briefly reach an edge with mismatched assets, leaving
      // the dashboard in an all-zero state.
      const candidates = ["./data/news.json", `./data/news.json?v=${Date.now()}`];
      let data = null;
      let lastError = null;
      for (const url of candidates) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const payload = await res.json();
          if (!Array.isArray(payload?.articles)) throw new Error("기사 목록 형식이 올바르지 않습니다.");
          data = payload;
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!data) throw lastError || new Error("뉴스 데이터 응답을 확인할 수 없습니다.");
      const rawArticles = prepareArticles(Array.isArray(data.articles) ? data.articles : []);
      // Grouped data keeps every original article, but the dashboard shows one
      // representative card per event. The remaining source links are rendered
      // inside that representative card.
      const visibleArticles = rawArticles.some((article) => article.eventId)
        ? rawArticles.filter((article) => article.eventRepresentative !== false)
        : rawArticles;
      state.articles = visibleArticles.map((article, index) => ({ ...article, __uiKey: `ui-${index}-${simpleHash(baseArticleKey(article))}`, selectionKey: `ui-${index}-${simpleHash(baseArticleKey(article))}` }));
      if ($("updatedAt")) $("updatedAt").textContent = data.generatedAt ? formatDate(data.generatedAt) : "-";
    } catch (err) {
      // Do not call applyFilters() after a loading failure: it used to replace
      // this useful error with the misleading "표시할 뉴스가 없습니다" and made
      // the whole dashboard look as if it simply contained zero articles.
      if ($("updatedAt")) $("updatedAt").textContent = "데이터 연결 오류";
      if ($("newsList")) {
        $("newsList").className = "news-list empty";
        $("newsList").textContent = `뉴스 데이터를 불러오지 못했습니다: ${err.message || err}`;
      }
      updateSelectionPreview();
      updateStats();
      return;
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
