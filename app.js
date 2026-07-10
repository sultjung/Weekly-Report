const state = {
  articles: [],
  filtered: [],
  selected: new Map(),
  activeTab: "all"
};

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "weekly-report-selected-v1";

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

function shortDate(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10);
  return `${d.getMonth() + 1}.${d.getDate()}`;
}

function categoryLabel(category3) {
  return {
    politics: "정치권 동향",
    terror_security: "이라크 주간 테러 상황",
    oil_economy: "경제 / 국제유가",
    regional: "국제사회",
    exclude: "제외/보류"
  }[category3] || "기타";
}

function getArticleKey(article) {
  return article.id || article.url || `${article.titleKo || article.title}-${article.publishedAt}`;
}

function loadSelection() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    state.selected = new Map(raw.map((item) => [getArticleKey(item), item]));
  } catch {
    state.selected = new Map();
  }
}

function saveSelection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.selected.values()]));
  updateSelectionPreview();
  updateStats();
}

function selectedPayload() {
  const selectedArticles = [...state.selected.values()].sort((a, b) => new Date(a.publishedAt || 0) - new Date(b.publishedAt || 0));
  return {
    generatedAt: new Date().toISOString(),
    purpose: "iraq-weekly-report-selected-news",
    count: selectedArticles.length,
    articles: selectedArticles
  };
}

function updateSelectionPreview() {
  $("selectionPreview").value = JSON.stringify(selectedPayload(), null, 2);
  $("statSelected").textContent = state.selected.size;
}

function inPeriod(article, period) {
  if (period === "all") return true;
  const d = new Date(article.publishedAt || article.date || 0);
  if (Number.isNaN(d.getTime())) return true;
  const days = Number(period);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return d >= cutoff;
}

function matchesSearch(article, query) {
  if (!query) return true;
  const text = [
    article.titleKo,
    article.title,
    article.summaryKo,
    article.weeklyReportReason,
    article.source,
    article.actors?.join(" "),
    article.location,
    article.reportBullet
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes(query.toLowerCase());
}

function applyFilters() {
  const period = $("periodFilter").value;
  const category = $("categoryFilter").value;
  const minImportance = Number($("importanceFilter").value || 0);
  const query = $("searchInput").value.trim();
  const selectedOnly = $("selectedOnly").checked;
  const hideExcluded = $("hideExcluded").checked;
  const tab = state.activeTab;

  state.filtered = state.articles.filter((article) => {
    const key = getArticleKey(article);
    const cat = article.category3 || "exclude";
    if (!inPeriod(article, period)) return false;
    if (category !== "all" && cat !== category) return false;
    if (tab !== "all" && cat !== tab) return false;
    if (hideExcluded && (cat === "exclude" || article.reportUsefulness === "exclude")) return false;
    if (selectedOnly && !state.selected.has(key)) return false;
    if (Number(article.importanceScore || 0) < minImportance) return false;
    if (!matchesSearch(article, query)) return false;
    return true;
  }).sort((a, b) => {
    const scoreDiff = Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    if (scoreDiff) return scoreDiff;
    return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
  });

  renderNews();
  updateStats();
}

function updateStats() {
  const all = state.articles;
  $("statTotal").textContent = all.length;
  $("statPolitics").textContent = all.filter((x) => x.category3 === "politics").length;
  $("statSecurity").textContent = all.filter((x) => x.category3 === "terror_security").length;
  $("statEconomy").textContent = all.filter((x) => x.category3 === "oil_economy").length;
  $("statRegional").textContent = all.filter((x) => x.category3 === "regional").length;
  $("statSelected").textContent = state.selected.size;
}

function renderNews() {
  $("visibleCount").textContent = `${state.filtered.length}건 표시`;
  const list = $("newsList");
  if (!state.filtered.length) {
    list.className = "news-list empty";
    list.textContent = "표시할 뉴스가 없습니다.";
    return;
  }

  list.className = "news-list";
  list.innerHTML = state.filtered.map((article) => {
    const key = getArticleKey(article);
    const selected = state.selected.has(key);
    const cat = article.category3 || "exclude";
    const reportPreview = [article.reportBullet, ...(article.reportSubBullets || []).map((x) => `* ${x}`), article.reportImplication ? `☞ ${article.reportImplication}` : ""].filter(Boolean).join("\n");
    return `
      <article class="news-card ${selected ? "selected" : ""}" data-key="${escapeHtml(key)}">
        <div class="news-top">
          <div class="news-meta">
            <span>${escapeHtml(article.source || "-")}</span>
            <span>${escapeHtml(formatDate(article.publishedAt))}</span>
            <span>중요도 ${Number(article.importanceScore || 0)}</span>
          </div>
          <button class="select-btn ${selected ? "on" : ""}" data-action="toggle" data-key="${escapeHtml(key)}">${selected ? "선택됨" : "보고서에 선택"}</button>
        </div>
        <h3 class="news-title">${escapeHtml(article.titleKo || article.title || "제목 없음")}</h3>
        <p class="news-summary">${escapeHtml(article.summaryKo || article.description || "")}</p>
        <div class="tag-row">
          <span class="tag ${cat}">${escapeHtml(categoryLabel(cat))}</span>
          <span class="tag">${escapeHtml(article.reportUsefulness || "watch")}</span>
          ${article.location ? `<span class="tag">${escapeHtml(article.location)}</span>` : ""}
          ${(article.actors || []).slice(0, 4).map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join("")}
        </div>
        ${article.weeklyReportReason ? `<p class="news-summary"><b>반영 사유</b> ${escapeHtml(article.weeklyReportReason)}</p>` : ""}
        ${reportPreview ? `<pre class="report-preview">${escapeHtml(reportPreview)}</pre>` : ""}
        <div class="card-actions">
          <a href="${escapeAttr(article.url || "#")}" target="_blank" rel="noopener noreferrer">원문 보기</a>
          <span>보고서 날짜: ${escapeHtml(shortDate(article.publishedAt))}</span>
        </div>
      </article>
    `;
  }).join("");
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
}
function escapeAttr(value = "") { return escapeHtml(value); }

function toggleSelection(key) {
  const article = state.articles.find((x) => getArticleKey(x) === key);
  if (!article) return;
  if (state.selected.has(key)) state.selected.delete(key);
  else state.selected.set(key, { ...article, selected: true });
  saveSelection();
  applyFilters();
}

async function copySelection() {
  const text = JSON.stringify(selectedPayload(), null, 2);
  await navigator.clipboard.writeText(text);
  alert("선택 기사 JSON을 복사했습니다. GitHub Actions의 selection_json 입력칸에 붙여 넣으세요.");
}

function downloadSelection() {
  const blob = new Blob([JSON.stringify(selectedPayload(), null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `selected-news-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadNews() {
  loadSelection();
  try {
    const res = await fetch(`./data/news.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.articles = Array.isArray(data.articles) ? data.articles : [];
    $("updatedAt").textContent = data.generatedAt ? formatDate(data.generatedAt) : "-";
  } catch (err) {
    $("newsList").className = "news-list empty";
    $("newsList").textContent = `뉴스 데이터를 불러오지 못했습니다: ${err.message || err}`;
  }
  updateSelectionPreview();
  applyFilters();
}

function bindEvents() {
  ["periodFilter", "categoryFilter", "importanceFilter", "searchInput", "selectedOnly", "hideExcluded"].forEach((id) => {
    $(id).addEventListener("input", applyFilters);
    $(id).addEventListener("change", applyFilters);
  });
  $("resetFilters").addEventListener("click", () => {
    $("periodFilter").value = "7";
    $("categoryFilter").value = "all";
    $("importanceFilter").value = "0";
    $("searchInput").value = "";
    $("selectedOnly").checked = false;
    $("hideExcluded").checked = true;
    state.activeTab = "all";
    document.querySelectorAll("#tabs button").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === "all"));
    applyFilters();
  });
  $("copySelection").addEventListener("click", copySelection);
  $("downloadSelection").addEventListener("click", downloadSelection);
  $("clearSelection").addEventListener("click", () => {
    if (!confirm("선택한 기사를 모두 초기화할까요?")) return;
    state.selected.clear();
    saveSelection();
    applyFilters();
  });
  $("tabs").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-tab]");
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === btn));
    applyFilters();
  });
  $("newsList").addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action='toggle']");
    if (!btn) return;
    toggleSelection(btn.dataset.key);
  });
}

bindEvents();
loadNews();
