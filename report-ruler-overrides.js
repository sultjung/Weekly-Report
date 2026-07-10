// Final browser-generated Word report ruler/indent overrides.
// Loaded last so these values win over earlier formatting patches.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  window.buildWordHtml = function buildWordHtmlWithTightHumanRuler(articles) {
    let html = previousBuildWordHtml(articles);

    const tightRulerCss = `
/* Human sample ruler alignment: 1. > 1) > • > - > * / ☞ */
@list l0 { mso-list-id:1001001; mso-list-type:hybrid; mso-list-template-ids:1001001; }
@list l0:level1 { mso-level-number-format:decimal; mso-level-text:"%1."; mso-level-tab-stop:0pt; mso-level-number-position:left; margin-left:0pt; text-indent:0pt; }
@list l1 { mso-list-id:1001002; mso-list-type:hybrid; mso-list-template-ids:1001002; }
@list l1:level1 { mso-level-number-format:decimal; mso-level-text:"%1)"; mso-level-tab-stop:18pt; mso-level-number-position:left; margin-left:18pt; text-indent:-18pt; }
p.word-list-main { font-size:16pt; font-weight:bold; margin:12pt 0 6pt 0pt; padding-left:0pt; text-indent:0pt; }
p.word-list-sub { font-size:14pt; font-weight:bold; margin:6pt 0 5pt 18pt; padding-left:0pt; text-indent:0pt; }
p.category { font-size:14pt; font-weight:bold; margin:5pt 0 4pt 34pt; padding-left:0pt; text-indent:0pt; }
p.item { margin:5pt 0 3pt 50pt; padding-left:0pt; text-indent:0pt; font-size:14pt; }
p.sub, p.implication { margin:0 0 3pt 62pt; padding-left:0pt; text-indent:0pt; font-size:13pt; }
p.impact { margin:5pt 0 3pt 42pt; padding-left:0pt; text-indent:0pt; font-size:13pt; }
`;

    html = html.replace("</style>", `${tightRulerCss}\n</style>`);
    return html;
  };
})();
