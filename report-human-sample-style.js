// Human weekly-report sample style.
// Loaded last: adjusts the International section into theme buckets such as
// "美·이스라엘-이란 분쟁 관련", "시리아 정세 관련", "가자/하마스 관련".
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  const esc = (value) => (typeof window.escapeHtml === "function"
    ? window.escapeHtml(value)
    : String(value || "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch])));

  function dateValue(article) {
    const d = new Date(article.publishedAt || article.date || 0);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  }

  function textOf(article) {
    return [
      article.titleKo,
      article.title,
      article.summaryKo,
      article.reportBullet,
      ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
      article.reportImplication,
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function themeOf(article) {
    const text = textOf(article);
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

  function renderItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;
    return articles.slice().sort((a, b) => dateValue(a) - dateValue(b)).map((article) => {
      const main = typeof window.reportMain === "function" ? window.reportMain(article) : `- ${article.titleKo || article.title || "주요 동향"}.`;
      const subs = typeof window.reportSubs === "function" ? window.reportSubs(article) : [];
      const implication = typeof window.reportImplication === "function" ? window.reportImplication(article) : "";
      return [
        `<p class="item">${esc(main)}</p>`,
        ...subs.map((x) => `<p class="sub">${esc(x)}</p>`),
        implication ? `<p class="implication">${esc(implication)}</p>` : ""
      ].filter(Boolean).join("");
    }).join("");
  }

  function renderInternationalByTheme(articles) {
    const regional = articles.filter((x) => x.category3 === "regional");
    if (!regional.length) return `<p class="category">• 이라크 관련 국제정세</p><p class="item empty-line">- 특이사항 없음</p>`;

    const order = [
      "美·이스라엘-이란 분쟁 관련",
      "시리아 정세 관련",
      "가자·하마스 관련",
      "홍해·후티 관련",
      "이라크 관련 국제정세"
    ];
    const grouped = new Map(order.map((x) => [x, []]));
    for (const article of regional) grouped.get(themeOf(article)).push(article);

    return order
      .filter((theme) => grouped.get(theme).length)
      .map((theme) => `<p class="category">• ${esc(theme)}</p>\n${renderItems(grouped.get(theme))}`)
      .join("\n");
  }

  window.buildWordHtml = function buildWordHtmlWithHumanSampleSections(articles) {
    let html = previousBuildWordHtml(articles);
    const themedInternational = renderInternationalByTheme(articles);

    html = html.replace(
      /(<p[^>]*class="h1[^\"]*"[^>]*>[\s\S]*?국제사회<\/p>)([\s\S]*?)(\s*<p[^>]*class="h1[^\"]*"[^>]*>[\s\S]*?그룹\s*\/\s*건설에 미치는 영향[\s\S]*?<\/p>)/,
      (_m, intro, _oldBlock, nextHeading) => `${intro}\n${themedInternational}\n${nextHeading}`
    );

    return html;
  };
})();
