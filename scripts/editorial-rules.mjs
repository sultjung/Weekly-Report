/**
 * Shared editorial policy for collection, high-value refinement, and final reports.
 * Keep durable rules here instead of copying large prompts across scripts.
 */

export const EDITORIAL_VERSION = "weekly-report-v14-source-lanes-final-template";

const COMMON_RULES = `
[사실성]
- 제공된 기사 근거만 사용한다. 다른 기사·외부 지식·추측을 섞거나 국가·기관·인물·날짜·수치·인과관계·전망을 만들지 않는다.
- fulltext는 본문 전체를 우선하고 rss-description은 제목·설명에서 확인되는 범위를 넘지 않는다.
- 공식 발표, 언론·소식통 주장, 영장 발부설, 압수수색, 압수물 발견, 당사자 부인, 검찰·법원 확인을 구분한다. 공식 근거 없이는 체포·유죄·부패 연루·무장세력 연계를 단정하지 않는다.
- 기사 작성지(dateline)와 실제 사건 장소를 구분하고, 제목보다 본문 첫 문단과 성명 발표 주체를 우선한다.

[편집]
- 먼저 단일 사건인지 종합 회의·공동성명·정책 패키지인지 판단한다. 결정 주체→실제 조치·사건→결과·진행 단계→원문상 맥락 순으로 중심축을 잡는다.
- titleKo는 날짜 없이 자연스러운 카드 제목, summaryKo는 제목을 반복하지 않는 1~2개 밀도 높은 한국어 문장이다. 독자가 원문 없이 주체·조치·현재 단계를 이해해야 한다.
- reportBullet은 M.D로 시작해 주체·장소·핵심 조치·결과가 보이는 45~90자 내외 보고서 소제목이다. reportSubBullets는 첫 줄과 겹치지 않는 구체 사실만 둔다.
- reportImplication은 원문에 구체적인 정치·안보·경제·BNCP 연결 근거가 있을 때만 1문장, 아니면 빈 문자열이다. '주목 필요·우려 증가·압박/의지 강화 가능성·신뢰 회복 기대' 같은 일반론은 금지한다.
- 짧고 단정적인 명사형 보고서 문체를 쓴다. 번역투·홍보문·과장·같은 사실 반복과 '~하였다/하고 있다/가능성이 있다'를 피한다.
- 종합 기사는 세부 안건 하나로 축소하지 않는다. reportBullet은 'M.D, 회의명/기관명 주요 의결 사항', summaryKo와 reportSubBullets는 중요한 결정 3~5개로 구성한다.

[기관·표기]
- الإطار التنسيقي=시아조정기구(SCF), مجلس النواب=이라크 의회, مجلس الوزراء=국무회의/내각회의. SCF를 이란 최고 의회·이란 의회·이라크 의회로 바꾸지 않는다.
- 표기 기준: NIC, 청렴위원회, 국가안보국(NSS), 인민동원군(PMF), 혁명수비대(IRGC), Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리, Al-Sadr, Al-Sistani, Khamenei, Soleimani, Trump 대통령.
- 이라크 인명은 특별한 예외 외에는 영문식 이름+Al-가문명과 필요한 직책만 쓰고 부친·조부명과 한국어 음역을 섞지 않는다. 주요 부처·기관은 통용 영문 약어로 통일한다.
- 지명은 프로젝트 기준을 일관되게 적용한다: Baghdad, Teheran, Najaf, Karbala, Qom, Salah al-Din州, Baghdad州.

[유형별]
- 수집 경로가 arabic_iraq_politics이면 이라크 정치권 동향만 politics로 작성한다. 관광·산업·일반 경제·유가·주택·디지털 전환 기사는 exclude한다.
- 수집 경로가 arabic_iraq_security이면 이라크 내 테러·치안 사건과 시위만 terror_security로 작성한다. 특히 Baghdad 시위의 장소·주최·요구사항·충돌 및 도로 통제 여부를 구분한다.
- 수집 경로가 oil_market이면 한국어 기사에서 보고기간 국제유가를 움직인 가장 큰 원인만 oil_economy로 작성한다. 이라크 관광·일반 경제·투자·주택 기사는 절대 이 항목에 넣지 않는다.
- 수집 경로가 regional_context이면 한국어 또는 영문 기사에서 이라크 현장 안전·대피·해운·공급망에 영향을 줄 수 있는 중동 핵심 정세만 regional로 작성한다.
- 한국어 원문은 번역하지 않고 핵심만 요약한다. 영문 원문은 자연스러운 한국어로 요약하고, 아랍어 원문은 허용된 이라크 정치·테러·시위 경로에서만 번역·요약한다.
- SCF의 '부패 연루자 정치적 보호 배제' 기사에서는 SCF가 주체다. Al-Maliki 前 총리 사무실 회의, Al-Zaidi 총리 방미 결과·국익 합의 이행 지지, 사법기관 확인 연루자에 대한 소속 불문 보호 배제만 근거대로 반영한다.
- 정치인 발언은 누구를 지지·비판·견제했는지, 구체 쟁점, 조건·선 긋기를 구분한다. 연정 영향은 원문에 세력 반응·회의·성명·내부 갈등이 있을 때만 쓴다.
- 치안 작전은 발표 기관·실제 장소·대상·체포/압수 결과·수사 단계를 쓴다. 드론 시설은 'NSS, Baghdad 내 불법 드론 제조시설 적발'처럼 구체화하고 기체는 '25대분'처럼 자연스럽게 쓴다. 연계·조달망은 확대 조사 중일 때만 수사 대상으로 표현한다.
- 미군 철수·IS 재출현·안보공백·민병대 무장·정부 무장해제를 함께 다룬 기사는 원문상 철수일과 목표일, 안보공백이 무기 보유 명분과 무장해제 추진에 주는 충돌을 유지한다. 필요한 경우 reportBullet 2~3문장을 허용한다.
- 비스마야·BNCP·한화 직접 관련 한국어·영문 기사는 핵심 후보로 보되 politics에 둔다.
- 이라크와 직접 무관한 국제뉴스·스포츠·연예·광고, 제3국 현지 범죄·테러, 무관한 농축산·식량 기사는 exclude한다. 제3국 사건을 이라크 테러로 분류하지 않는다.
`.trim();

const COLLECTION_SCHEMA = `
JSON 객체만 출력한다(마크다운 금지). 필수 키:
titleKo, summaryKo, category1, category2, category3, importanceScore, reportUsefulness, weeklyReportReason, reportBullet, reportSubBullets, reportImplication, actors, location, securityEventType, securityEventCount, sourceReliability.
category1: domestic|international. category2: politics_security|economy|international. category3: politics|terror_security|oil_economy|regional|exclude.
reportUsefulness: include|watch|exclude. 일반 기사의 reportSubBullets는 0~2개, 종합 기사는 3~5개이며 접두사 '* '를 넣지 않는다. reportImplication에는 '☞'를 넣지 않는다.
securityEventType: armed_attack|ied|assassination|protest|shooting|suicide_bombing|other|none. terror_security가 아니면 none과 0을 사용한다. securityEventCount는 기사에서 확인되는 독립 사건 건수이며 불명확하면 1이다.
`.trim();

const REPORT_SCHEMA = `
JSON 객체만 출력하고 키는 reportBullet, reportSubBullets, reportImplication만 사용한다.
기존 분류는 바꾸지 않는다. 일반 기사의 reportSubBullets는 0~2개, 종합 기사는 3~5개이며 '* '를 넣지 않는다. reportImplication은 근거가 없으면 빈 문자열이다.
`.trim();

export function collectionPrompt(context = {}) {
  return [
    "기사를 한국어 주간 종합상황보고서 후보로 분류·요약한다. 원문 근거에서 번역 또는 요약과 분류를 수행한다.",
    `수집 경로(고정 분류를 임의 변경하지 말 것): ${JSON.stringify(context)}`,
    COMMON_RULES,
    COLLECTION_SCHEMA
  ].join("\n\n");
}

export function refinementPrompt(article) {
  return [
    "기존 기사 분류와 사실을 유지하며 실제 보고서 문장만 재편집한다.",
    COMMON_RULES,
    REPORT_SCHEMA,
    "기사 데이터:",
    JSON.stringify(article, null, 2)
  ].join("\n\n");
}

export function finalReportPrompt(items) {
  const output = '{"internationalTopic":"중동 주요 정세","sections":{"politics":[{"sourceArticleIds":["id"],"reportBullet":"","reportSubBullets":[],"reportImplication":""}],"terror_security":[],"oil_economy":[],"regional":[]},"groupImpacts":[]}';
  return [
    "선택 기사 전체를 검토해 실제 7월 23일 최종본과 같은 밀도의 한국어 주간 종합상황보고서로 편집한다.",
    COMMON_RULES,
    "동일 category3와 eventId의 같은 사건은 하나로 병합하고 서로 다른 추가 사실은 하위 문장에 둔다. 모든 입력 id는 sourceArticleIds에 정확히 한 번 포함하며 category3를 이동하지 않는다.",
    "oil_economy는 보고기간 국제유가를 움직인 가장 큰 원인 중심으로 중복 사건을 병합한다. regional은 중요 중동 정세만 남기며, internationalTopic은 내용을 대표하는 10~24자 소제목으로 작성한다.",
    "groupImpacts는 근거가 있는 그룹/건설 영향만 0~2문장, 일반론이면 빈 배열이다.",
    `JSON만 출력한다. 구조: ${output}`,
    "선택 기사:",
    JSON.stringify(items, null, 2)
  ].join("\n\n");
}

export const editorialPromptBytes = () => Buffer.byteLength(collectionPrompt(), "utf8");
