/**
 * Narrow AI contract for the first-pass article stage.
 * The model translates and extracts evidence-backed facts only.
 * Relevance, category, importance, report writing, and implications are code-owned.
 */

export const FACT_EXTRACTION_VERSION = "weekly-report-v16-evidence-facts-only";

const OUTPUT_SHAPE = `{
  "translatedTitleKo": "한국어 제목",
  "titleEvidenceQuote": "제목 또는 본문에서 그대로 복사한 연속 원문",
  "facts": [
    {"sentenceKo": "원문에 확인되는 사실 1문장", "evidenceQuote": "그 사실을 뒷받침하는 연속 원문"}
  ],
  "actors": [
    {"nameKo": "인물·기관명", "roleKo": "원문에 명시된 직책 또는 빈 문자열", "evidenceQuote": "이름·직책을 뒷받침하는 연속 원문"}
  ],
  "location": {"nameKo": "실제 사건 장소 또는 빈 문자열", "evidenceQuote": "장소를 뒷받침하는 연속 원문 또는 빈 문자열"},
  "articleStructure": "single_event 또는 multi_issue"
}`;

export function factExtractionPrompt(context = {}) {
  return [
    "당신의 역할은 번역가 겸 사실 추출기다. 기사 채택 여부나 중요성을 판단하지 않는다.",
    `처리 정보: ${JSON.stringify(context)}`,
    "[해야 할 일]",
    "- 한국어 원문은 의미를 바꾸지 않고 제목만 정리한다. 아랍어·영문 원문은 자연스러운 한국어로 옮긴다.",
    "- 원문에서 확인되는 핵심 사실을 1~3개만 추출한다. 각 사실은 주체·행동·대상·확인된 결과 중심의 짧은 문장으로 쓴다.",
    "- 인물·기관·직책·장소는 원문에 명시된 경우에만 추출한다.",
    "- 모든 제목·사실·인물·장소에는 이를 뒷받침하는 원문의 연속 구절을 evidenceQuote로 그대로 복사한다.",
    "- evidenceQuote는 번역하거나 요약하지 말고, 제공된 기사 데이터 안에서 6~160자를 연속으로 복사한다.",
    "- 기사에 여러 안건이 나란히 있으면 articleStructure를 multi_issue로 표시하고 사실을 최대 3개로 나눈다.",
    "[하지 말아야 할 일]",
    "- 관련성 판정, 분야 분류, 점수 계산, 채택·제외 판정은 하지 않는다.",
    "- 보고서 소제목, 하위 항목, 시사점, 전망, 회사 영향, 권고사항은 작성하지 않는다.",
    "- publishedAt을 기사 내용의 사건 날짜로 재해석하지 않는다.",
    "- 원문에 없는 국가·기관·인물·직책·장소·날짜·수치·인과관계를 만들지 않는다.",
    "- 관련기사 제목, 메뉴, 광고, 사진 설명을 본문 사실처럼 섞지 않는다.",
    "JSON 객체만 출력한다. 마크다운과 설명문은 금지한다.",
    `출력 구조: ${OUTPUT_SHAPE}`
  ].join("\n");
}

export const factPromptBytes = () => Buffer.byteLength(factExtractionPrompt(), "utf8");
