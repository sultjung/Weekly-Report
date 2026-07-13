// Client-side corrections for known high-value articles already present in data/news.json.
// This updates visible cards until the next collection run rewrites data/news.json.
(function () {
  function isMalikiCard(card) {
    const text = card.textContent || "";
    const sourceBtn = card.querySelector("button[data-url]");
    const url = sourceBtn?.dataset?.url || "";
    return /964media\.com\/696180/i.test(url) || (/Nouri\s+Al-Maliki|말리키|Al-Maliki/i.test(text) && /전투탱크|반부패|부패|Al-Zaidi/i.test(text));
  }

  function setText(el, text) {
    if (el) el.textContent = text;
  }

  function correctMalikiCard(card) {
    if (!card || card.dataset.knownArticleCorrected === "true") return;
    const title = card.querySelector(".news-title");
    setText(title, "Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 前 정부 부패 비판");

    const summaries = card.querySelectorAll("p.news-summary");
    if (summaries[0]) {
      summaries[0].textContent = "Nouri Al-Maliki 前 총리는 언론 인터뷰에서 Al-Sudani 前 총리 정부 시기 부패가 약탈 수준으로 확대되었다고 강하게 비판. 전력·항만 등 주요 부문에서 부패가 심각하게 확산되었다고 주장하는 한편, Al-Zaidi 총리의 반부패 체포·압수수색 작전을 정치 신뢰 회복을 위한 충격요법으로 평가. 다만 반부패 작전은 법적 절차와 제도적 기준 안에서 지속되어야 한다고 조건 제시.";
    }
    if (summaries[1]) {
      summaries[1].innerHTML = "<b>반영 사유</b> Al-Maliki 前 총리의 Al-Zaidi 총리 반부패 공세 공개 지지와 前 정부 부패 비판은 신임 총리의 부패척결 드라이브 및 시아 정치권 내부 역학 파악에 중요.";
    }

    const preview = card.querySelector(".report-preview");
    if (preview) {
      preview.textContent = [
        "7.7, Al-Maliki 前 총리, Al-Zaidi 총리 반부패 공세 지지 및 Al-Sudani 前 총리 정부 시기 부패 강력 비판",
        "* Al-Maliki 前 총리, 전 정부 시기 부패가 단순 부패를 넘어 약탈 수준으로 확대되었으며 전력·항만 등 주요 부문에서 확산되었다고 주장.",
        "* Al-Zaidi 총리의 체포·압수수색 등 반부패 작전은 국민 신뢰 회복을 위한 충격요법으로 평가.",
        "* 다만 반부패 작전은 법적 절차와 제도적 기준, 정치적 통제 안에서 지속되어야 한다고 조건 제시.",
        "☞ Al-Maliki 前 총리의 공개 지지는 Al-Zaidi 총리의 반부패 드라이브에 힘을 실어주는 동시에, 향후 수사 범위가 법치국가연합·시아조정기구(SCF) 내부로 확대될 가능성에 대비한 정치적 방어선 설정으로 해석."
      ].join("\n");
    }

    card.dataset.knownArticleCorrected = "true";
  }

  function apply() {
    document.querySelectorAll(".news-card").forEach((card) => {
      if (isMalikiCard(card)) correctMalikiCard(card);
    });
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
