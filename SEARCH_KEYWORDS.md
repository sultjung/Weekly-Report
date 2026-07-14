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

두 실행 방식 모두 `scripts/run-collector.mjs`를 사용하며, 실행 과정에서 `scripts/prepare-search-keywords.mjs`가 위 JSON 파일의 검색어를 최종 수집기에 적용합니다.

기존 `scripts/collect-news.mjs`와 패치 파일 안의 검색어 배열은 실행 과정에서 JSON 내용으로 교체되므로 관리 대상으로 보지 않습니다.
