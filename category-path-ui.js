// Show the exact weekly-report category path on each news card.
(function () {
  function textOf(card) {
    return card.textContent || "";
  }

  function hasClass(card, className) {
    return !!card.querySelector(`.tag.${className}`);
  }

  function internationalTheme(card) {
    const text = textOf(card).toLowerCase();
    if (/iran|이란|israel|이스라엘|trump|트럼프|irgc|혁명수비대|호르무즈|hormuz|미군기지|us bases|바레인|bahrain|쿠웨이트|kuwait|미사일|missile|drone|드론|공습|airstrike|memorandum|양해각서/.test(text)) {
      return "美·이스라엘-이란 분쟁 관련";
    }
    if (/sdf|sna|시리아민주군|시리아국가군|syria|시리아|튀르키예|turkey|isis camps|is 수용소|난민캠프/.test(text)) {
      return "시리아 정세 관련";
    }
    if (/gaza|가자|hamas|하마스|hostage|인질|팔레스타인|palestine/.test(text)) {
      return "가자·하마스 관련";
    }
    if (/houthi|후티|red sea|홍해|yemen|예멘/.test(text)) {
      return "홍해·후티 관련";
    }
    return "이라크 관련 국제정세";
  }

  function categoryPath(card) {
    if (hasClass(card, "politics")) {
      return "1. 이라크 국내 상황 > 1) 정국 / 치안 > • 정치권 동향";
    }
    if (hasClass(card, "terror_security")) {
      return "1. 이라크 국내 상황 > 1) 정국 / 치안 > • 이라크 주간 테러 상황";
    }
    if (hasClass(card, "oil_economy")) {
      const text = textOf(card);
      if (/건설주택부|주거도시|환경기준|도시계획|단열재|녹지|건설자재|housing|construction/i.test(text)) {
        return "1. 이라크 국내 상황 > 2) 경제 > • 건설·주택·투자환경 동향";
      }
      return "1. 이라크 국내 상황 > 2) 경제 > • 국제유가 관련 동향";
    }
    if (hasClass(card, "regional")) {
      return `2. 국제사회 > • ${internationalTheme(card)}`;
    }
    if (hasClass(card, "exclude")) {
      return "제외/보류 > 보고서 후보 제외";
    }
    return "기타 > 분류 확인 필요";
  }

  function applyCategoryPaths() {
    const cards = document.querySelectorAll(".news-card");
    cards.forEach((card) => {
      const path = categoryPath(card);
      let box = card.querySelector(".category-path-line");
      if (!box) {
        box = document.createElement("div");
        box.className = "category-path-line";
        const title = card.querySelector(".news-title");
        if (title && title.nextSibling) title.parentNode.insertBefore(box, title.nextSibling);
        else if (title) title.insertAdjacentElement("afterend", box);
        else card.prepend(box);
      }
      box.innerHTML = `<b>카테고리</b> ${path}`;
    });
  }

  function injectStyle() {
    if (document.getElementById("category-path-ui-style")) return;
    const style = document.createElement("style");
    style.id = "category-path-ui-style";
    style.textContent = `
      .category-path-line {
        display: inline-flex;
        align-items: center;
        width: fit-content;
        max-width: 100%;
        margin: -2px 0 2px;
        padding: 6px 10px;
        border-radius: 999px;
        background: #fff7ed;
        border: 1px solid #fed7aa;
        color: #9a3412;
        font-size: 14px;
        font-weight: 800;
        line-height: 1.35;
      }
      .category-path-line b {
        margin-right: 7px;
        color: #c2410c;
      }
      @media (max-width: 640px) {
        .category-path-line {
          display: flex;
          width: 100%;
          border-radius: 12px;
          font-size: 13px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function schedule() {
    window.requestAnimationFrame(() => window.requestAnimationFrame(applyCategoryPaths));
  }

  window.addEventListener("DOMContentLoaded", () => {
    injectStyle();
    const list = document.getElementById("newsList");
    if (list) new MutationObserver(schedule).observe(list, { childList: true, subtree: false });
    schedule();
  });
})();
