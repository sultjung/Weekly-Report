// Hide untranslated Arabic news cards from the visible candidate list.
// This is a UI safety net for articles whose AI translation failed after collection.
(function () {
  const ARABIC_RE = /[\u0600-\u06FF]/;
  const KOREAN_RE = /[가-힣]/;

  function isMostlyUntranslated(card) {
    const title = card.querySelector(".news-title")?.textContent || "";
    const summary = card.querySelector(".news-summary")?.textContent || "";
    const combined = `${title}\n${summary}`.trim();
    if (!combined) return false;
    return ARABIC_RE.test(combined) && !KOREAN_RE.test(title + summary.replace(/^반영 사유.*$/m, ""));
  }

  function apply() {
    const list = document.getElementById("newsList");
    const count = document.getElementById("visibleCount");
    if (!list) return;
    const cards = Array.from(list.querySelectorAll(".news-card"));
    if (!cards.length) return;

    let hidden = 0;
    for (const card of cards) {
      if (isMostlyUntranslated(card)) {
        card.style.display = "none";
        card.dataset.untranslatedHidden = "true";
        hidden += 1;
      }
    }

    if (count && hidden) {
      const visible = cards.filter((card) => card.style.display !== "none").length;
      count.textContent = `${visible}건 표시`;
    }
  }

  const observer = new MutationObserver(apply);
  window.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("newsList");
    if (list) observer.observe(list, { childList: true, subtree: true });
    apply();
  });
})();
