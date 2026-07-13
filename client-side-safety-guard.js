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
    /Yusuf\s*Kanawi|유수프\s*카나위|يوسف\s*كناوي/i
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
