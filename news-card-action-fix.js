// Fix news-card action behavior.
// - Selecting a card should not re-render/re-sort the entire list.
// - Source links should open directly and never move the page to the top.
(function () {
  function getCardFromTarget(target) {
    return target?.closest?.(".news-card") || null;
  }

  function setCardSelectedState(card, selected) {
    if (!card) return;
    card.classList.toggle("selected", selected);
    const button = card.querySelector("button[data-action='toggle']");
    if (button) {
      button.classList.toggle("on", selected);
      button.textContent = selected ? "선택됨" : "보고서에 선택";
    }
  }

  function toggleWithoutRerender(key, card) {
    if (!key || typeof state === "undefined" || !(state.selected instanceof Map)) return false;
    const article = state.articles.find((x) => getArticleKey(x) === key);
    if (!article) return false;

    const wasSelected = state.selected.has(key);
    if (wasSelected) state.selected.delete(key);
    else state.selected.set(key, { ...article, selected: true, selectionKey: key });

    // Persist and update counters without calling applyFilters/renderNews.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.selected.values()]));
    } catch {}
    if (typeof updateSelectionPreview === "function") updateSelectionPreview();
    if (typeof updateStats === "function") updateStats();
    if (typeof updateCategoryCards === "function") updateCategoryCards();
    setCardSelectedState(card, !wasSelected);

    return true;
  }

  function onSelectClick(event) {
    const button = event.target.closest?.("button[data-action='toggle']");
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const card = getCardFromTarget(button);
    const key = button.dataset.key || card?.dataset.key || "";

    const selectedOnly = document.getElementById("selectedOnly")?.checked;
    const activeCategory = typeof state !== "undefined" ? state.activeCategory : "all";

    // In selected-only views, the clicked card may need to disappear from the list.
    // There, re-rendering is acceptable; preserve position as best as possible.
    if (selectedOnly || activeCategory === "selected") {
      const y = window.scrollY;
      if (typeof toggleSelection === "function") toggleSelection(key);
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "auto" }));
      return;
    }

    if (!toggleWithoutRerender(key, card) && typeof toggleSelection === "function") {
      const y = window.scrollY;
      toggleSelection(key);
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "auto" }));
    }
  }

  function onSourceLinkClick(event) {
    const link = event.target.closest?.(".card-actions a");
    if (!link) return;

    const href = (link.getAttribute("href") || "").trim();
    if (!href || href === "#" || href === "about:blank") {
      event.preventDefault();
      event.stopPropagation();
      alert("이 기사에는 열 수 있는 원문 링크가 없습니다.");
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    window.open(href, "_blank", "noopener,noreferrer");
  }

  function bind() {
    const list = document.getElementById("newsList");
    if (!list || list.dataset.cardActionFixBound === "true") return;
    list.dataset.cardActionFixBound = "true";
    list.addEventListener("click", onSelectClick, true);
    list.addEventListener("click", onSourceLinkClick, true);
  }

  window.addEventListener("DOMContentLoaded", bind);
  bind();
})();
