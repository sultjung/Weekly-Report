# 검색 키워드 관리

Google News 검색어는 아래 파일 한 곳에서만 관리합니다.

```text
data/search-keywords.json
```

## 수정 방법

1. `data/search-keywords.json`을 엽니다.
2. 주제에 맞는 그룹의 배열에 검색어를 추가하거나 삭제합니다.
3. JSON 문법을 유지합니다. 각 검색어는 큰따옴표로 감싼 문자열이며 항목 사이는 쉼표로 구분합니다.
4. 같은 검색어를 중복 입력하면 검증 workflow가 실패합니다.

## 검색 경로별 원칙

| 그룹 | 검색 언어/지역 | 보고서 항목 |
|---|---|---|
| `arabic_iraq_politics` | 아랍어 / 이라크 | 정치권 동향 |
| `arabic_iraq_security_protests` | 아랍어 / 이라크 | 테러·치안·시위 |
| `korean_oil_market` | 한국어 / 한국 | 국제유가 관련 동향 |
| `korean_middle_east` | 한국어 / 한국 | 중동 주요 정세 |
| `english_middle_east_fallback` | 영문 / 미국 | 중동 주요 정세 보완 |

아랍어 일반 경제·관광·산업·유가·주택 검색어는 사용하지 않습니다. 이라크 현지 언론 직접 수집 기사도 정치·테러·시위 신호가 없으면 AI 번역 전에 제외합니다.

## 적용 범위

- GitHub Actions의 `Collect Iraq Weekly News`
- 로컬 또는 수동 실행의 `npm run collect`

`scripts/collect-news.mjs`가 실행할 때 이 JSON을 직접 읽으므로 자동·수동 실행에 동일하게 반영됩니다.
