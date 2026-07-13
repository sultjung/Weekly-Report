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
