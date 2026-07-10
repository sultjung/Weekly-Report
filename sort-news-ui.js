// News list sorting UI override.
// The base app filters first; this script then reorders the visible cards.
// Default sort is latest first, not importance first.
(function () {
  let applying = false;

  function parseImportance(card) {
    const text = card.textContent || "";
    const match = text.match(/중요도\s*(\d+)/);
    return match ? Number(match[1]) : 0;
  }

  function parseKoreanDate(text = "") {
    // Example: 2026. 07. 10. 오전 02:08 / 2026. 07. 10. 오후 08:49
    const match = String(text).match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)?\s*(\d{1,2})?:?(\d{2})?/);
    if (!match) return 0;
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const ampm = match[4] || "";
    let hour = Number(match[5] || 0);
    const minute = Number(match[6] || 0);
    if (ampm === "오후" && hour < 12) hour += 12;
    if (ampm === "오전" && hour === 12) hour = 0;
    return new Date(year, month, day, hour, minute).getTime() || 0;
  }

  function parsePublishedAt(card) {
    const metaSpans = card.querySelectorAll(".news-meta span");
    const dateText = metaSpans[1]?.textContent || "";
    return parseKoreanDate(dateText);
  }

  function currentSort() {
    return document.getElementById("sortFilter")?.value || "latest";
  }

  function sortCards() {
    if (applying) return;
    const list = document.getElementById("newsList");
    if (!list) return;
    const cards = Array.from(list.querySelectorAll(".news-card"));
    if (cards.length < 2) return;

    const sort = currentSort();
    const sorted = cards.slice().sort((a, b) => {
      const ad = parsePublishedAt(a);
      const bd = parsePublishedAt(b);
      const ai = parseImportance(a);
      const bi = parseImportance(b);

      if (sort === "oldest") return ad - bd || bi - ai;
      if (sort === "importance") return bi - ai || bd - ad;
      return bd - ad || bi - ai;
    });

    applying = true;
    const fragment = document.createDocumentFragment();
    sorted.forEach((card) => fragment.appendChild(card));
    list.appendChild(fragment);
    applying = false;
  }

  function scheduleSort() {
    window.requestAnimationFrame(() => window.requestAnimationFrame(sortCards));
  }

  window.addEventListener("DOMContentLoaded", () => {
    const sort = document.getElementById("sortFilter");
    if (sort) sort.addEventListener("change", scheduleSort);

    const list = document.getElementById("newsList");
    if (list) {
      new MutationObserver(scheduleSort).observe(list, { childList: true });
    }
    scheduleSort();
  });
})();
