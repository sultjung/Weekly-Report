# Iraq Weekly Report Builder

이라크 정치·치안·시위와 한국어 국제유가, 한국어·영문 중동 주요 정세를 수집하고, 한국어 주간보고서 후보와 DOCX 보고서를 생성하는 GitHub Pages 프로젝트입니다.

## 핵심 구조

```text
index.html / style.css / app.js     웹 화면
data/search-keywords.json           Google News 검색어 단일 관리
data/iraq-media-sources.json        직접 수집 언론사 목록
scripts/collect-news.mjs             뉴스 수집·전문 확보·AI 요약
scripts/postprocess-news.mjs         번역 용어·오류·중복 후처리 실행
scripts/generate-weekly-report.mjs   DOCX 보고서 생성
```

## 실행

```bash
npm run validate      # 구조·문법·필수 설정 검사
npm run collect       # 뉴스 수집
npm run postprocess   # 수집 데이터 후처리
npm run report        # 선택 기사 DOCX 생성
```

GitHub Actions의 `Collect Iraq Weekly News`도 동일한 `collect → postprocess` 경로를 사용합니다.

## 검색어 수정

검색어는 `data/search-keywords.json` 한 파일에서만 관리합니다. 자세한 형식은 `SEARCH_KEYWORDS.md`를 참고하세요.

DOCX는 `templates/weekly-report-template.docx`의 승인된 최종 양식을 그대로 열어 내용만 채웁니다. 웹브라우저는 더 이상 HTML을 `.doc`로 저장하지 않으며, 선택 JSON을 복사해 `Generate Weekly Report` Actions를 여는 역할만 담당합니다.

최종 보고서 생성 시 전체형 모델이 입력 기사를 사용/제외로 판정하고, 중복 사건을 병합한 뒤 실제 보고서 문체로 다시 편집합니다. 정치·치안은 사용자가 선택한 기사를 검토하고, 국제유가와 중동 주요 정세는 보고기간 내 전용 검색 경로의 중요 후보를 자동으로 보완합니다. 국제유가 표는 보고일 2일 전부터 전일까지의 한국석유공사 오피넷 Dubai·Brent·WTI 일간가격을 사용합니다.

## 유지보수 원칙

- 브라우저 코드는 `app.js` 한 파일만 배포합니다.
- 수집기는 실행 중 별도 패치 파일을 생성하지 않습니다.
- NINA는 본문·사이드바 혼입 문제로 수집 대상에서 제외합니다.
- 데이터 보정은 `scripts/postprocess-news.mjs`에 정의된 순서로 실행합니다.
