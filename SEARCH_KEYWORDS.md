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

## 적용 범위

- GitHub Actions의 `Collect Iraq Weekly News`
- 로컬 또는 수동 실행의 `npm run collect`

`scripts/collect-news.mjs`가 실행할 때 이 JSON을 직접 읽으므로 자동·수동 실행에 동일하게 반영됩니다.
