#!/usr/bin/env node
/**
 * Runs the canonical news collector with the user's concise weekly-report
 * writing style injected at runtime. The source collector stays centralized,
 * while this wrapper provides a fail-fast style override and cache version bump.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = process.cwd();
const SOURCE_FILE = path.join(ROOT, "scripts", "collect-news.mjs");
const OLD_VERSION = "weekly-report-v5-evidence";
const NEW_VERSION = "weekly-report-v12-human-editorial-method";

const STYLE_START = `    "summaryKo는 3~5줄 한국어 요약. 제목 문장을 그대로 반복하지 말고, 기사 본문에서 확인되는 핵심 주장·비판 대상·조건·정치적 의미를 압축하라.",`;
const STYLE_END = `    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`;

const REPORT_STYLE_BLOCK = [
  `    "summaryKo는 2~4줄 한국어 요약. 기사 본문의 핵심 사실과 의미를 충분히 담되 제목 문장을 그대로 반복하지 말라.",`,
  `    "summaryKo와 보고서 문장은 구분하라. summaryKo는 기사 이해용이고, reportBullet·reportSubBullets는 실제 주간보고서에 바로 넣을 수 있는 압축 문장이어야 한다.",`,
  `    "[사람 편집자 방식] 단순 번역·축약이 아니라, 먼저 기사 전체를 읽고 '이번 주 보고서에서 무엇이 실제로 보고할 사건인가'를 판단하라. 자극적인 제목·인용문·세부 수치 하나가 아니라 결정 주체, 실제 조치 또는 사건, 결과·진행 단계, 관련 맥락의 순서로 중심축을 잡는다.",`,
  `    "titleKo는 카드에서 기사 성격을 즉시 알 수 있는 자연스러운 한국어 제목으로, reportBullet은 날짜로 시작하는 보고서 소제목으로 각각 작성하라. 둘 중 어느 하나도 원문 제목의 기계적 번역이나 '혼란 발생', '우려 증가', '주목 필요' 같은 추상적 표현만으로 끝내지 말라.",`,
  `    "카드용 titleKo와 summaryKo에는 날짜를 앞에 붙이지 말라. 발행일은 카드 상단 메타정보에, 날짜 표기는 reportBullet에만 둔다.",`,
  `    "summaryKo는 독자가 원문을 보지 않아도 누가·무엇을·어떻게 했고 현재 어느 단계인지 이해하도록 1~2개의 밀도 있는 문장으로 작성한다. reportBullet에는 사건의 중심 사실만, reportSubBullets에는 체포·압수 규모·결정 조건·당사자 입장·후속 절차처럼 중심 문장에 넣지 않은 근거만 배치한다.",`,
  `    "기사의 정치·사업상 맥락은 원문이 직접 제시한 연결고리가 있을 때만 포함한다. 이때도 사실(공식 발표·보도·당사자 부인·수사 단계)과 해석을 섞지 말고, 해석은 보고에 실질적으로 필요한 경우에만 제한적으로 쓴다. 근거 없는 일반론은 빈 시사점보다 낫지 않다.",`,
  `    "작성 전 내부 점검: ① 제목만 읽어도 사건 주체·사안이 보이는가, ② 보고 첫 줄이 날짜·주체·핵심 조치를 담는가, ③ 하위 문장이 첫 줄을 반복하지 않고 증거를 보태는가, ④ 원문에 없는 원인·전망·확정 판단이 없는가, ⑤ 같은 유형 기사에도 적용 가능한 표현인가를 확인하라.",`,
  `    "먼저 기사가 단일 사안 기사인지, 여러 결정·지시·사업·현안을 함께 다룬 종합 회의·공식 발표 기사인지 판단하라. 정부·의회·정당·공공기관·국제기구 등의 회의 결과, 공동성명, 정책 패키지, 정례 브리핑, 업무보고가 후자에 해당한다.",`,
  `    "종합 회의·공식 발표 기사에서는 특정 세부 안건 하나를 제목·핵심 요약·카테고리의 중심으로 삼지 말라. titleKo는 'M.D 회의명/기관명 주요 의결 사항' 또는 'M.D 기관명 종합 발표 주요 내용'처럼 기사 전체를 대표하게 작성하고, category는 개별 안건이 아닌 정부 운영·정책결정·의회 활동·대외정책 등 기사 전체 성격을 기준으로 정하라.",`,
  `    "종합 기사 summaryKo는 정치·경제·사회·대외관계상 중요한 결정 3~5개를 번호 목록으로 정리하되, 결정 주체·조치 내용·대상 또는 목적이 드러나게 작성하라. 사소한 의전·행정 안건과 근거 없는 효과 전망은 제외하라.",`,
  `    "종합 기사 reportBullet은 'M.D, 회의명/기관명 주요 의결 사항' 형식의 제목 역할을 하게 작성하고, reportSubBullets에 핵심 결정 3~5개를 번호 없이 각각 한 줄로 작성하라. 이 경우 reportImplication은 기사에 명시된 별도 사업·정치적 함의가 없으면 빈 문자열로 둔다.",`,
  `    "보고서 문체는 사용자가 직접 작성한 정세보고 문체를 따른다. 짧고 단정적인 명사형·음슴체를 사용하고 기사 설명문, 홍보문, 번역투를 피하라.",`,
  `    "reportBullet은 최종 주간보고서에 바로 넣을 수 있도록 핵심 내용을 보고서 형식으로 압축하라. 반드시 1문장일 필요는 없지만 불필요하게 길게 쓰지 말라.",`,
  `    "reportBullet은 M.D 형식의 날짜로 시작하고 주체·장소·행동·결과를 포함하라. 기사 제목을 그대로 번역하지 말라.",`,
  `    "이라크·비스마야·한화·NIC·치안·유가·물류와 직접 연결되는 경우에만 사업 또는 파급효과를 언급하라. 연결 근거가 없으면 일반적인 영향 가능성을 덧붙이지 말라.",`,
  `    "기사에 없는 원인·전망·피해·정치적 의미를 추가하지 말라. '~하였다', '~하고 있다', '주목된다', '가능성이 있다' 같은 해설형 표현을 피하고 짧고 단정적인 보고서 문체를 사용하라.",`,
  `    "reportBullet은 보통 45~90자 내외로 압축하되, 글자 수 때문에 사건의 핵심 조건·결과를 버리지 말라. 복합 사안은 한 줄 제목과 서로 다른 근거의 하위 문장으로 나눈다.",`,
  `    "reportBullet은 인명보다 직책이 핵심이면 직책 중심으로 압축하라. 예: Tom Barrack보다 '美이라크 특사', Donald Trump보다 'Trump 대통령', Ali Al-Zaidi보다 'Al-Zaidi 총리'.",`,
  `    "미국 관련 직책은 보고서식으로 '美이라크 특사', '美국무장관', '美대통령'처럼 표기할 수 있으며 양국 관계는 '미-이라크', '한-이라크'처럼 간결하게 표기하라.",`,
  `    "reportBullet 예시: '7.14, 美이라크 특사, 미-이라크 양국 정상 회동은 양국간 안보·투자·무역 전환점으로 평가'.",`,
  `    "외교·투자·에너지 기사에서는 회동의 상징성이나 광범위한 국가 목록을 장황하게 나열하지 말고, 양국 관계 변화와 실제 사업·투자 방향을 우선하라.",`,
  `    "GCC, Turkey, Syria, Jordan, Central Asia, Balkans, Caucasus처럼 여러 지역이 열거돼도 보고서 핵심이 아니면 '역내 연계 확대'로 압축하거나 생략하라.",`,
  `    \"reportSubBullets는 '* ' 없이 0~2개만 작성하라. reportBullet에 담지 못한 구체적 사실이 있을 때만 작성하고, 기대·가능성·영향을 일반론으로 덧붙이지 말라.\",`,
  `    "reportSubBullets는 reportBullet을 다시 풀어쓰지 말고 서로 다른 의미를 담아라. 같은 사실을 표현만 바꿔 반복하지 말라.",`,
  `    "reportSubBullets 예시: '본 회동을 계기로 양국 관계가 경제·투자 중심으로 확장될 것으로 기대', '이라크 내 에너지 인프라 분야의 미국 기업 진출 강화로 이어질 것으로 기대'.",`,
  `    "'메시지 강조', '기대 부각', '활용 가능', '핵심 연결축으로 규정', '사업기회 확대에 직결' 같은 기사 해설형 상투어를 보고서 문장에 반복하지 말라.",`,
  `    "정치 기사에서는 누가 누구를 지지·비판·견제했는지와 실제 조치만 남기고, 배경 설명은 필요한 경우 한 개의 하위 문장으로 압축하라.",`,
  `    \"기관 주체를 제목의 단어만 보고 추론하지 말고 기사 본문 첫 문단과 성명 주체를 우선 확인하라. 'الإطار التنسيقي'는 이라크 시아조정기구(SCF)이며 이란 최고 의회·이란 의회·이라크 의회로 번역하지 말라. 'مجلس النواب'만 이라크 의회, 'مجلس الوزراء'만 국무회의/내각회의를 뜻한다.\",`,
  `    \"'الإطار التنسيقي ... لا حماية للمتورطين بالفساد' 유형의 기사에서는 주체를 반드시 시아조정기구(SCF)로 표기하라. 해당 기사 핵심은 ① Al-Maliki 前 총리 사무실에서 Al-Zaidi 총리와 SCF 지도자들이 제284차 회의를 열고 방미 결과 및 국익 관련 합의 이행을 지지한 사실, ② 사법기관이 부패 연루를 확인한 인물에게 소속과 관계없이 정치적 보호를 제공하지 않겠다는 방침이다.\",`,
  `    \"위 유형의 기사에서 이란·이란 최고 의회·이란 의회·최고지도자 등 원문에 없는 주체를 절대 추가하지 말라. '부패 척결 의지가 신뢰 회복으로 이어질 가능성', '정치적 책임성 강화로 해석' 같은 일반적 전망 문장은 근거가 없으면 작성하지 말라.\",`,
  `    "반부패·체포·압수수색 기사에서는 전 정부 책임론, 신임 총리 지지, 법적 절차 요구, 특정 세력 견제 중 원문에 근거가 있는 핵심 축만 선택하라.",`,
  `    "수사·부패 의혹 기사는 사실의 법적 단계를 엄격히 구분하라. 언론 보도·소식통 주장·체포영장 발부설·압수수색·압수물 발견·당사자 부인·검찰 또는 법원의 공식 확인을 서로 같은 사실로 쓰지 말고, 원문에 있는 단계만 '보도', '주장', '설', '확인', '부인'으로 정확히 표기하라. 공식 발표·법원 문서가 없으면 체포·유죄·부패 연루를 단정하지 말라.",`,
  `    "정치권 관련성은 기사 근거가 있을 때만 적어라. 특정 인사의 의혹이 여당·연정·정당·정치연합에 미칠 영향은 해당 세력의 반응, 보호·비호 여부, 회의·성명 또는 내부 갈등이 원문에 제시될 때만 구체적으로 설명한다. 근거 없이 '정부 연합 혼란', '정치적 압력 증가', '불안정성 증대' 같은 일반적 해석을 제목·요약·시사점에 추가하지 말라.",`,
  `    "이라크 인물은 특별히 정한 예외를 제외하고 영문식 '이름 + Al-가문명'으로 간략 표기하고, 한국어 음역·부친명·조부명을 섞지 말라. 직책·전직 여부가 중요하면 뒤에 붙인다. 예: Ahmed Al-Asadi 前 MOLSA 장관, Al-Zaidi 총리. 이라크 부처·주요 정부기관은 보고서에서 통용되는 영문 약어를 우선 사용하며, 최초 표기부터 하나의 약어로 통일한다.",`,
  `    "안보 기사에서는 사건 발생 사실, 주체, 피해·대응 결과를 우선하고 일반적인 경계 강화 필요성이나 지역 불안 가능성은 근거가 뚜렷할 때만 적어라.",`,
  `    "치안·테러·무기·드론 제조 관련 기사에서는 기사 성격을 먼저 구분하라. 치안기관의 공식 작전·압수수색 발표이면 발표 기관, 작전 대상, 체포·압수 결과, 수사 단계만 사실대로 정리한다. '음모', '테러조직', '무장세력 연계'처럼 법적·정치적 평가가 담긴 표현은 원문 또는 공식 발표가 명시한 경우에만 사용한다.",`,
  `    "불법 드론 제조시설 적발 기사에서는 제목을 '이라크 국가안보국(NSS), Baghdad 내 불법 드론 제조시설 적발'처럼 기관·장소·사안을 구체적으로 작성한다. NSS는 '국가안보국(NSS)'으로 통일한다. '드론 제조 음모 차단'처럼 추상적·과장된 제목은 사용하지 않는다.",`,
  `    "해당 유형의 summaryKo에는 용의자 수, 드론 기체·부품 등 압수 규모, 최종 조립·운용 배치 전 적발 여부, 원문에 명시된 추가 수사 범위를 포함한다. 지역 무장세력 연계와 자재 조달망은 '확대 조사 중'이라는 원문 근거가 있을 때만 수사 대상 또는 가능성으로 표기하고, 연계 사실로 단정하지 않는다.",`,
  `    "해당 유형의 reportBullet은 'M.D, 국가안보국(NSS), Baghdad 내 불법 드론 제조시설 적발' 형식을 우선하며, reportSubBullets에는 '용의자 3명 체포 및 드론 기체 25대분 압수', '최종 조립·운용 배치 전 적발, 지역 무장세력 연계 및 자재 조달망 확대 조사 중'처럼 서로 다른 핵심 사실만 배치한다.",`,
  `    "경제·투자 기사에서는 승인·계약·예산·사업 추진·기업 진출 등 실행 결과와 비스마야·한화·NIC에 미칠 수 있는 직접 영향을 우선하라.",`,
  `    "reportImplication은 '☞' 없이 기본적으로 빈 문자열로 둬라. reportBullet과 reportSubBullets만으로 전달되지 않는 구체적 사업 영향·정치적 함의·조직 정의가 있을 때만 1문장 작성하라.",`,
  `    "reportImplication에 '정치적 압박 강화 가능성', '의지 강화 가능성', '향후 주목 필요' 같은 일반론을 쓰지 말라. 별도 시사점이 없으면 반드시 빈 문자열을 출력하라.",`,
  `    "보고서 문체는 '~하였다/했다/하고 있다/규정함/강조함/부각함'을 피하고 '~평가', '~가결', '~승인', '~체결', '~촉구', '~비판', '~지지', '~전망', '~기대', '~필요' 형태를 우선한다.",`,
  `    "인명·기관명은 보고서식 표기를 사용하라: Al-Zaidi 총리, Al-Sudani 前 총리, Al-Maliki 前 총리, Al-Sadr, Al-Sistani, Khamenei, Soleimani, Pezeshkian 대통령, Trump 대통령, 인민동원군(PMF), 혁명수비대(IRGC), 시아조정기구(SCF), 시리아민주군(SDF), 시리아국가군(SNA).",`,
  `    "지명은 가능하면 영문식으로 표기하라: Baghdad, Teheran, Najaf, Karbala, Qom, Salah al-Din州, Baghdad州.",`,
  `    "美·이스라엘-이란 분쟁, 시리아 SDF-SNA 교전, 가자/하마스 인질 관련 기사는 국제사회 섹션 후보로 적극 분류하라.",`,
  `    "PMF 해체·무장해제, Al-Sadr·Al-Sistani의 PMF 관련 입장, Soleimani 추모, Khamenei의 미군 철수 촉구는 이라크 국내 정치/치안 동향 후보로 적극 분류하라.",`,
  `    "이라크와 무관한 국제뉴스, 스포츠, 연예, 광고성 기사는 exclude.",`,
  `    "농업·축산·감자·종자·식량안보·농산물 생산처럼 비스마야/주거도시·NIC·한화·정치·치안·에너지와 직접 연결되지 않은 기사는 경제·국제유가 기사로 분류하지 말고 반드시 exclude 처리하라.",`,
  `    "영국·유럽·미국 등 제3국의 현지 범죄·테러·반이슬람 사건은 이라크 정부·국민·공관·사업 또는 중동 안보에 직접 연결되지 않으면 반드시 exclude 처리하라.",`,
  `    "제3국의 현지 치안 사건을 '이라크 주간 테러 상황'으로 분류하지 말라.",`,
  `    "기사에 없는 숫자, 인과관계, 전망을 만들지 말라. '기대', '전망', '이어질 것으로 예상'은 기사 본문에 해당 근거가 있을 때만 사용하라.",`,
  `    "시아조정기구(SCF) 내부 갈등, 장관 후보자 미확정, 내각 완성 지연, 총리 방미 이후 전망, 의회 본회의 재개, 장관 신임투표 미실시, NIC 의장 해임안, 청렴위원회 이관 관련 기사는 정치권 동향 핵심 후보로 적극 분류하라.",`,
  `    "건설주택부의 신규 주거도시, 환경기준, 도시계획 기준, 단열재, 녹지비율, 자국 건설자재 우선 사용 관련 기사는 주간보고서 경제/투자환경 후보로 적극 분류하라.",`,
  `    "국가투자위원회는 NIC로 표기하고, 부패방지위원회보다 청렴위원회 표현을 사용하라."`
].join("\n");

function replaceStyleBlock(source) {
  const start = source.indexOf(STYLE_START);
  const endStart = source.indexOf(STYLE_END, start);
  if (start < 0 || endStart < 0) {
    throw new Error("Collector prompt markers changed; report-style override was not applied");
  }
  const end = endStart + STYLE_END.length;
  return `${source.slice(0, start)}${REPORT_STYLE_BLOCK}${source.slice(end)}`;
}

function bumpSummaryVersion(source) {
  const matches = source.split(OLD_VERSION).length - 1;
  if (matches !== 2) {
    throw new Error(`Expected 2 summary-version markers, found ${matches}`);
  }
  return source.replaceAll(OLD_VERSION, NEW_VERSION);
}

function replaceExactlyOnce(source, search, replacement, label) {
  const matches = source.split(search).length - 1;
  if (matches !== 1) {
    throw new Error(`Expected exactly one ${label} anchor, found ${matches}`);
  }
  return source.replace(search, replacement);
}

function hardenReportScope(source) {
  source = replaceExactlyOnce(
    source,
    `  articles = articles.map((item) => reuseFromPrevious(item, previousMap));`,
    `  articles = articles.map((item) => reuseFromPrevious(item, previousMap)).filter((item) => scoreCandidate(item).reportUsefulness !== "exclude");`,
    "cached article scope recheck"
  );

  source = replaceExactlyOnce(
    source,
    `.filter((item) => !item.aiCacheHit && canSummarizeFromEvidence(item))`,
    `.filter((item) => !item.aiCacheHit && item.reportUsefulness !== "exclude" && item.category3 !== "exclude" && canSummarizeFromEvidence(item))`,
    "pre-AI exclusion"
  );

  return source;
}

async function run() {
  const original = await fs.readFile(SOURCE_FILE, "utf8");
  const patched = hardenReportScope(bumpSummaryVersion(replaceStyleBlock(original)));
  const tempFile = path.join(os.tmpdir(), `weekly-report-collector-${process.pid}.mjs`);

  try {
    await fs.writeFile(tempFile, patched, "utf8");
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [tempFile], {
        cwd: ROOT,
        env: process.env,
        stdio: "inherit"
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (signal) reject(new Error(`Collector terminated by signal ${signal}`));
        else resolve(code ?? 1);
      });
    });
    if (exitCode !== 0) process.exit(exitCode);
  } finally {
    await fs.rm(tempFile, { force: true });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
