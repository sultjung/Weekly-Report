// Prevent scroll jumps after news-card actions.
// Selecting a card re-renders the list, and broken/empty source links can point to '#'.
// This guard preserves the user's scroll position around those actions.
(function () {
  let savedY = null;
  let restoreUntil = 0;

  function isNewsCardAction(target) {
    if (!target) return false;
    return !!target.closest("button[data-action='toggle'], .select-btn, .card-actions a");
  }

  function saveScroll() {
    savedY = window.scrollY || document.documentElement.scrollTop || 0;
    restoreUntil = Date.now() + 700;
  }

  function restoreScroll() {
    if (savedY === null) return;
    if (Date.now() > restoreUntil) {
      savedY = null;
      return;
    }
    window.scrollTo({ top: savedY, left: 0, behavior: "auto" });
  }

  function scheduleRestore() {
    restoreScroll();
    window.requestAnimationFrame(() => {
      restoreScroll();
      window.requestAnimationFrame(() => {
        restoreScroll();
        window.setTimeout(restoreScroll, 80);
        window.setTimeout(restoreScroll, 220);
        window.setTimeout(() => { savedY = null; }, 800);
      });
    });
  }

  document.addEventListener("pointerdown", (event) => {
    if (isNewsCardAction(event.target)) saveScroll();
  }, true);

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".card-actions a");
    if (link) {
      const href = link.getAttribute("href") || "";
      if (!href || href === "#" || href.endsWith("/#")) {
        event.preventDefault();
        alert("원문 링크가 없는 기사입니다.");
        scheduleRestore();
        return;
      }
      scheduleRestore();
      return;
    }

    if (isNewsCardAction(event.target)) {
      scheduleRestore();
    }
  }, true);

  window.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("newsList");
    if (!list) return;
    new MutationObserver(() => {
      if (savedY !== null) scheduleRestore();
    }).observe(list, { childList: true, subtree: true });
  });
})();
