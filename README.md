# Iraq Weekly Report Builder

`Weekly-Report`는 이라크 주간 종합상황보고서 작성을 위한 뉴스 수집·분류·선별·보고서 생성 전용 웹앱입니다.

## 목적

- 매일 이라크 정치·치안·경제·국제정세 뉴스를 자동 수집합니다.
- 수집된 뉴스를 주간보고서 구조에 맞게 분류합니다.
- 사용자가 화면에서 보고서에 넣을 뉴스를 직접 선택합니다.
- 선택한 뉴스만 기반으로 Word 보고서를 생성합니다.

## 기본 구조

```text
index.html
style.css
app.js
data/news.json
data/news-index.json
data/iraq-media-sources.json
scripts/collect-news.mjs
scripts/generate-weekly-report.mjs
.github/workflows/collect-news.yml
.github/workflows/generate-weekly-report.yml
reports/latest.docx
reports/generated/
```

## 사용 순서

1. GitHub Secrets에 `OPENAI_API_KEY`를 등록합니다.
2. Actions → `Collect Iraq Weekly News`를 실행합니다.
3. GitHub Pages에서 뉴스를 확인하고 보고서에 넣을 뉴스를 선택합니다.
4. `선택 기사 JSON 다운로드` 또는 `선택 JSON 복사`를 사용합니다.
5. Actions → `Generate Weekly Report`를 실행하고 `selection_json`에 선택 JSON을 붙여 넣습니다.
6. 생성된 보고서는 `reports/latest.docx` 및 `reports/generated/`에 저장됩니다.

## 중요한 원칙

- 모든 뉴스를 자동으로 보고서에 넣지 않습니다.
- AI는 후보를 분류하고 요약하지만, 최종 보고서 반영 여부는 사용자가 선택합니다.
- 보고서에 들어갈 때는 날짜 흐름순으로 정렬합니다.
- 기사에 없는 숫자, 원인, 결과는 만들지 않습니다.
- 내각회의/COM 표는 사용자가 선택한 주요 뉴스일 때만 반영합니다.
