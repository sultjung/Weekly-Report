// Final browser report writing cleanup rules learned from user edits.
// Applies immediately to the downloaded Word-compatible report, even before the next news collection run.
(function () {
  const previousBuildWordHtml = window.buildWordHtml;
  if (typeof previousBuildWordHtml !== "function") return;

  function applyLearnedWritingRules(html) {
    let out = String(html || "");

    const replacements = [
      [/이라크의?\s+정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
      [/정치적?\s+조정\s+기구/g, "시아조정기구(SCF)"],
      [/자이드\s+정부의\s+완성/g, "이라크 내각 구성"],
      [/자이드\s+정부/g, "Al-Zaidi 총리 내각"],
      [/Ali\s+Al-Zaidi\s+총리/g, "Al-Zaidi 총리"],
      [/Al-Zaidi\s+총리\s+총리/g, "Al-Zaidi 총리"],
      [/대규모\s*방문\s*위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문\s*최고위원회\s*위원장/g, "대규모 순례행사 최고위원회 위원장"],
      [/대규모\s*방문\s*위원회/g, "대규모 순례행사 최고위원회"],
      [/아르바인\s*기념일\s*준비/g, "아르바인 순례 준비"],
      [/아르바인\s*방문\s*준비/g, "아르바인 순례 준비"]
    ];
    for (const [pattern, replacement] of replacements) out = out.replace(pattern, replacement);

    out = out.replace(
      /이라크 내각 구성이 미국 방문 이후로 미뤄졌다\.\s*시아조정기구\(SCF\)(?:는|은)? 장관 임명 결정을 미국 방문 결과에 연계하고 있다\.\s*이는 정치적 불확실성을 더욱 부각시키고 있다\./g,
      "이라크 내각 구성이 Al-Zaidi 총리의 미국 방문 이후로 미뤄짐에 따라 정치적 불확실성을 더욱 부각시키고 있음."
    );

    out = out.replace(
      /-\s*(\d{1,2}\.\d{1,2}),\s*시아조정기구\(SCF\),\s*장관 임명 결정을 미국 방문 결과에 연계\.?/g,
      "- $1, 시아조정기구(SCF), 미국 방문 결과에 연계하여 장관 임명 결정."
    );

    out = out.replace(
      /<p class="implication">☞\s*부패 척결을 위한 정치적 의지가 강화될 가능성\.?<\/p>/g,
      "<p class=\"implication\">☞ 반부패 수사로 정치권 내 연정 합의가 흔들리며 내각 구성 지연 가능성 제기.</p>"
    );
    out = out.replace(
      /\s*<p class="implication">☞\s*정치적 압박이 강화될 가능성이 있다\.?<\/p>/g,
      ""
    );
    out = out.replace(
      /\s*<p class="implication">☞\s*정치적 압박 강화 가능성\.?<\/p>/g,
      ""
    );

    return out;
  }

  window.buildWordHtml = function buildWordHtmlWithLearnedWritingCleanup(articles) {
    return applyLearnedWritingRules(previousBuildWordHtml(articles));
  };
})();
