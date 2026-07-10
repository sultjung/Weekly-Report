// Browser-generated Word report font-size overrides.
// Main article summary lines beginning with '-' use 14pt.
// Detail lines beginning with '*' and implications beginning with '☞' use 13pt.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  window.buildWordHtml = function buildWordHtmlWithReportFontSizes(articles) {
    let html = previousBuildWordHtml(articles);

    html = html.replace(
      ".item { margin:8pt 0 5pt 76pt; text-indent:10pt; }",
      ".item { margin:8pt 0 5pt 76pt; text-indent:10pt; font-size:14pt; }"
    );
    html = html.replace(
      ".item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; }",
      ".item { margin: 8pt 0 5pt 76pt; text-indent: 10pt; font-size: 14pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin:0 0 4pt 100pt; text-indent:8pt; }",
      ".sub, .implication { margin:0 0 4pt 100pt; text-indent:8pt; font-size:13pt; }"
    );
    html = html.replace(
      ".sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; }",
      ".sub, .implication { margin: 0 0 4pt 100pt; text-indent: 8pt; font-size: 13pt; }"
    );

    return html;
  };
})();
