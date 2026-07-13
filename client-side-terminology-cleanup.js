// Client-side terminology cleanup for already-generated news cards.
// This only changes display text until the next collection run applies the glossary to data/news.json.
(function () {
  const RULES = [
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
    for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
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
