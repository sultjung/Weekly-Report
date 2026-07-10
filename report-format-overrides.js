// Browser-generated Word report format tweaks.
// Keeps app.js stable while matching the human weekly report's paragraph spacing/indent feel.
(function () {
  const originalBuildWordHtml = window.buildWordHtml;
  if (typeof originalBuildWordHtml !== "function") return;

  window.buildWordHtml = function buildWordHtmlWithReportSpacing(articles) {
    let html = originalBuildWordHtml(articles);

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
