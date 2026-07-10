// Browser-generated Word report format and article-merge tweaks.
// Keeps app.js stable while matching the human weekly report's paragraph spacing/indent feel.
// Also merges related selected articles into a single report item with follow-up bullets and analysis implications.
(function () {
  const originalBuildWordHtml = window.buildWordHtml;
  if (typeof originalBuildWordHtml !== "function") return;

  function textOf(article) {
    return [
      article.titleKo,
      article.title,
      article.summaryKo,
      article.weeklyReportReason,
      article.reportBullet,
      ...(Array.isArray(article.reportSubBullets) ? article.reportSubBullets : []),
      article.reportImplication,
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean).join(" ");
  }

  function norm(value) {
    return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
  }

  function dateOnly(article) {
    const d = new Date(article.publishedAt || article.date || 0);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayDiff(a, b) {
    const ad = dateOnly(a);
    const bd = dateOnly(b);
    if (!ad || !bd) return 99;
    return Math.abs(ad - bd) / 86400000;
  }

  function tokenSet(article) {
    const text = norm(textOf(article));
    const keys = new Set();

    const candidates = [
      ...(Array.isArray(article.actors) ? article.actors : []),
      article.location,
      article.source
    ].filter(Boolean);
    for (const item of candidates) {
      const cleaned = norm(item).replace(/[()\[\],.]/g, " ").replace(/\s+/g, " ").trim();
      if (cleaned && cleaned.length >= 2) keys.add(cleaned);
    }

    const dictionary = [
      "iraq", "iran", "baghdad", "teheran", "tehran", "qom", "najaf", "karbala", "amedi", "khamenei",
      "al-zaidi", "zaidi", "al-sudani", "nouri al-maliki", "al-maliki", "al-sadr", "scf", "pmf",
      "nic", "council of ministers", "cabinet", "parliament", "integrity commission",
      "이라크", "이란", "baghdad", "teheran", "qom", "najaf", "karbala", "amedi", "khamenei", "카메네이",
      "장례식", "운구", "유해", "최고지도자", "대통령", "총리", "관계 재정립", "공식 행사",
      "시아조정기구", "청렴위원회", "내각회의", "의회", "분석", "연구소", "싱크탱크",
      "건설주택부", "주거도시", "환경기준", "도시계획", "단열재", "녹지", "자국 건설자재",
      "isis", "is", "rocket", "missile", "drone", "attack", "protest", "kidnap", "terror",
      "oil", "opec", "budget", "hormuz", "brent", "wti", "dubai"
    ];
    for (const key of dictionary) {
      if (text.includes(norm(key))) keys.add(norm(key));
    }

    return keys;
  }

  function isAnalysisArticle(article) {
    const text = norm(textOf(article));
    return /분석|연구소|싱크탱크|전문가|정치연구소|보고서|논평|관측|해석|전망|신호|관계 재정립|analyst|analysis|institute|think tank|research|expert|commentary|assessment|signal/.test(text);
  }

  function sharedTokenCount(a, b) {
    const as = tokenSet(a);
    const bs = tokenSet(b);
    let count = 0;
    for (const key of as) if (bs.has(key)) count += 1;
    return count;
  }

  function relatedScore(a, b) {
    let score = 0;
    const shared = sharedTokenCount(a, b);
    score += shared * 2;
    if (a.category3 && b.category3 && a.category3 === b.category3) score += 2;
    if (dayDiff(a, b) <= 7) score += 2;

    const combo = norm(`${textOf(a)} ${textOf(b)}`);
    const strongThemes = [
      ["khamenei", "qom"], ["khamenei", "najaf"], ["khamenei", "karbala"], ["khamenei", "teheran"], ["khamenei", "tehran"],
      ["카메네이", "qom"], ["카메네이", "najaf"], ["카메네이", "karbala"], ["카메네이", "teheran"],
      ["장례식", "운구"], ["유해", "운구"], ["공식 행사", "관계 재정립"],
      ["주거도시", "환경기준"], ["주거도시", "단열재"], ["주거도시", "녹지"], ["건설주택부", "도시계획"]
    ];
    for (const pair of strongThemes) {
      if (pair.every((x) => combo.includes(norm(x)))) score += 5;
    }
    return score;
  }

  function pickPrimary(articles) {
    const sorted = articles.slice().sort((a, b) => {
      const aa = isAnalysisArticle(a) ? 1 : 0;
      const bb = isAnalysisArticle(b) ? 1 : 0;
      if (aa !== bb) return aa - bb;
      const ad = dateOnly(a);
      const bd = dateOnly(b);
      if (ad && bd) return ad - bd;
      return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    });
    return sorted[0] || articles[0];
  }

  function articleMain(article) {
    return window.reportMain ? window.reportMain(article) : `- ${article.titleKo || article.title || "주요 동향"}.`;
  }

  function articleSubs(article) {
    if (window.reportSubs) return window.reportSubs(article);
    const summary = String(article.summaryKo || "").split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 2);
    return summary.map((x) => `* ${x.replace(/[.。]+$/g, "")}.`);
  }

  function articleImplication(article) {
    if (window.reportImplication) return window.reportImplication(article);
    return article.reportImplication ? `☞ ${article.reportImplication}` : "";
  }

  function clusterArticles(articles) {
    const sorted = articles.slice().sort((a, b) => {
      const ad = dateOnly(a);
      const bd = dateOnly(b);
      if (ad && bd) return ad - bd;
      return Number(b.importanceScore || 0) - Number(a.importanceScore || 0);
    });

    const clusters = [];
    for (const article of sorted) {
      let best = null;
      let bestScore = 0;
      for (const cluster of clusters) {
        const score = Math.max(...cluster.articles.map((x) => relatedScore(article, x)));
        if (score > bestScore) {
          bestScore = score;
          best = cluster;
        }
      }
      if (best && bestScore >= 7) best.articles.push(article);
      else clusters.push({ articles: [article] });
    }

    return clusters.map((cluster) => {
      const primary = pickPrimary(cluster.articles);
      const related = cluster.articles.filter((x) => x !== primary);
      return { primary, related, articles: cluster.articles };
    });
  }

  function cleanLine(value) {
    return String(value || "").replace(/^[-*☞·•\s]+/, "").replace(/[.。]+$/g, "").trim();
  }

  function sourcePrefix(article) {
    const source = String(article.source || "").trim();
    if (!source) return "";
    if (/institute|research|center|centre|council|foundation|연구소|센터|재단|협회|전문가/i.test(source)) return `${source}, `;
    return "";
  }

  function renderMergedReportItems(articles) {
    if (!articles.length) return `<p class="item empty-line">- 특이사항 없음</p>`;

    return clusterArticles(articles).map((cluster) => {
      const { primary, related } = cluster;
      const normalRelated = related.filter((x) => !isAnalysisArticle(x));
      const analysisRelated = related.filter(isAnalysisArticle);
      const lines = [];

      lines.push(`<p class="item">${window.escapeHtml(articleMain(primary))}</p>`);

      const subCandidates = [
        ...articleSubs(primary),
        ...normalRelated.flatMap((article) => articleSubs(article).slice(0, 2))
      ].map(cleanLine).filter(Boolean);
      const seenSubs = new Set();
      for (const sub of subCandidates) {
        const key = sub.slice(0, 80);
        if (seenSubs.has(key)) continue;
        seenSubs.add(key);
        lines.push(`<p class="sub">${window.escapeHtml(`* ${sub}.`)}</p>`);
        if (seenSubs.size >= 4) break;
      }

      const implicationCandidates = [
        ...analysisRelated.map((article) => {
          const raw = cleanLine(articleImplication(article) || article.weeklyReportReason || article.summaryKo || article.titleKo || article.title);
          return raw ? `☞ ${sourcePrefix(article)}${raw}.` : "";
        }),
        !analysisRelated.length ? articleImplication(primary) : ""
      ].map((x) => String(x || "").trim()).filter(Boolean);

      const seenImplications = new Set();
      for (const implication of implicationCandidates) {
        const key = implication.slice(0, 100);
        if (seenImplications.has(key)) continue;
        seenImplications.add(key);
        lines.push(`<p class="implication">${window.escapeHtml(implication)}</p>`);
        if (seenImplications.size >= 2) break;
      }

      return lines.join("");
    }).join("");
  }

  window.buildWordHtml = function buildWordHtmlWithMergedRelatedArticles(articles) {
    let html = originalBuildWordHtml(articles);

    const categories = [
      { key: "politics", marker: "${renderReportItems(politics)}" },
      { key: "terror_security", marker: "${renderReportItems(security)}" },
      { key: "oil_economy", marker: "${renderReportItems(economy)}" },
      { key: "regional", marker: "${renderReportItems(regional)}" }
    ];

    const byCat = (cat) => articles.filter((x) => x.category3 === cat).sort((a, b) => (dateOnly(a) || 0) - (dateOnly(b) || 0));

    // The original buildWordHtml has already interpolated report items, so replace the content between category headings instead.
    html = html.replace(
      /(<p class="category">• 정치권 동향<\/p>)([\s\S]*?)(\s*<table class="report-table cabinet-table">|\s*<p class="category">• 이라크 주간 테러 상황<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("politics"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 이라크 주간 테러 상황<\/p>\s*[\s\S]*?<\/table>)([\s\S]*?)(\s*<p class="h2">2\) 경제<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("terror_security"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 국제유가 관련 동향<\/p>)([\s\S]*?)(\s*<table class="report-table oil-table">)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("oil_economy"))}\n  ${b}`
    );
    html = html.replace(
      /(<p class="category">• 이라크와 관련 있는 주변국·국제정세<\/p>)([\s\S]*?)(\s*<p class="h1">3\. 그룹 \/ 건설에 미치는 영향<\/p>)/,
      (m, a, _old, b) => `${a}\n  ${renderMergedReportItems(byCat("regional"))}\n  ${b}`
    );

    html = html.replace(
      ".item { margin-left: 64pt; }",
      ".item { margin: 8pt 0 5pt 64pt; text-indent: 10pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin-left: 78pt; }",
      ".sub, .implication { margin: 0 0 4pt 88pt; text-indent: 8pt; }"
    );
    html = html.replace(
      ".impact { margin-left: 42pt; }",
      ".impact { margin: 7pt 0 4pt 54pt; text-indent: 8pt; }"
    );
    html = html.replace(
      ".category { font-size: 14pt; font-weight: bold; margin: 10pt 0 7pt 42pt; }",
      ".category { font-size: 14pt; font-weight: bold; margin: 12pt 0 8pt 42pt; }"
    );

    return html;
  };
})();
