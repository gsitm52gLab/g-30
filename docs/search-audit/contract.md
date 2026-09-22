# G14 검색·감사 서버 계약

G14 원본 fa2491b의 전체 검색·감사 기능을 async 공통 저장소 기반 eece434로 이식한 작성자 후보다. UI·HTTP·실제 Supabase 및 독립 검증은 각각 실제 결과 패킷으로 구분한다. 합성 입력만 사용하고 환경 비밀값은 서버 메모리 밖으로 출력하지 않으며 새로운 외부 LLM 호출은 하지 않는다.

## 읽기 API

모든 응답은 기존 세션 인증과 현재 컨텍스트 권한을 재검사한다. GET은 읽음, 수락, 알림 동기화 또는 감사 쓰기를 하지 않는다. Cache-Control은 `no-store, private`다. `src/domain/search/types.ts`와 `src/domain/audit/view.ts`가 반환 타입의 기준이다.

| API | 입력 | 반환 |
|---|---|---|
| GET `/api/search/contexts` | 없음 | 현재 허용 contexts, actor `{id,role}`, sideEffects:`none` |
| GET `/api/search` | 아래 검색 query | SearchList |
| GET `/api/search/history` | context, kind(실제 sourceKind), id(sourceId) | SearchDetail |
| GET `/api/audit` | 아래 감사 query | AuditList, GSG audit.read 필요 |
| GET `/api/audit/:id` | context | AuditItem |

검색 query는 `context` 필수, `q,kind,mode,product,sku,jan,task,status,actor,assignee,from,to,page,pageSize` 선택이다. kind는 searchKinds의 값, mode는 current(기본)/history다. history는 과거와 현재를 함께 조회한다. page는 1부터, pageSize는 기본20/최대50이다. 날짜는 YYYY-MM-DD이고 상하한을 포함한다. q/SKU/JAN은 NFKC 대소문자 정규화한 리터럴 포함 검색이며 정규식이 아니다. 나머지 ID/status 필터는 정확 비교다. q에는 허용된 제목·본문·파일명만 사용한다. 중복/알 수 없는 파라미터, 비유한/소수 페이지, 잘못된 날짜는422다.

감사 query는 검색 query에서 `mode`를 제외한다(전달하면422). 항상 저장된 이벤트 이력을 조회한다. status는 `filters.actions[].value`인 operation action이다. kind/product/task/SKU/JAN은 현재 권한으로 투영된 실제 관련 원본과 비교한다. 감사 q는 한국어 작업명, 허용 대상·버전 제목, readable before/after를 검색한다. 검색과 감사의 actor 필터 값은 반환된 actor.id를 그대로 사용한다.

예: `/api/search?context=ctx-jp-a-luna&q=0012&kind=product&mode=history&jan=0012&page=1&pageSize=20`; `/api/audit?context=ctx-jp-a-luna&status=task.published&from=2026-01-01`.

## 투영·이력·화면 계약

현재 source ACL과 원본 AND 참조 파일 권한을 확인한 뒤 allowlist scalar를 투영하고, 그 뒤 match/count/order/page를 계산한다. 권한 없는 컨텍스트, 다른 브랜드 팀원의 사적 문의, 내부 내용, 비권한 내부 공급가 및 내부 공급가가 포함된 import batch/감사 이벤트는 filter options와 total에도 포함하지 않는다. G16 입력·분석·근거는 GSG 내부 한정이다. 알림은 현재 본인만 조회하며 알림 전송/읽음 부수효과가 없다.

SearchHit의 `sourceKind/sourceId`가 정확 조회 주소다. `historyUrl`은 UI가 구현할 `/search/history?context=...&kind=...&id=...`이며 GET history로 받은 그 기록만 표시한다. 잘못된 관계/ID/철회에는404, 최신으로 대체하지 않는다. `sourcePrecision=exact_version`은 불변 원본을 읽었다는 뜻이다. current_record는 가변 현재 기록이다. 상세 `fields`는 한국어 label/value, files는 허용된 정확 파일 ID/name/downloadUrl/previewUrl만 포함한다. 원시 JSON을 주요 UI로 사용하지 않는다.

`sourceUrlPrecision=exact_version`은 원 producer 페이지에 실제 버전 선택 계약이 있는 공지·행사 공개본·AI 입력/실행/근거 URL에만 붙인다. 다른 원본 링크는 related_current이며 ‘관련 현재 화면’으로 표시한다. 별도의 `historyUrl`은 정확 기록 상세를 유지한다. 행사 참여/실물/후속 fact의 관련 행사 페이지는 해당 fact 자체 선택으로 가장하지 않는다. 과거 제품 공통 버전에 현재 SKU/JAN을 붙이지 않고, 과거 가격에 현재 상품명을 추정하지 않는다.

`statusPrecision`은 current/historical/unavailable을 구분한다. 메시지에 붙인 질문 상태처럼 현재 producer의 상태를 표시할 경우 current다. `isCurrent`는 검색 기본 모드 포함 여부이며 승인·완료를 뜻하지 않는다. `total`은 허용된 기록/버전 hit 수이고 고유 상품 수가 아니다. 현행 공통/컨텍스트/가격 기록은 서로 다른 hit다. 화면은 표시 단위를 명확히 한다.

작성자 ID는 불변 producer의 publishedBy/changedBy/recordedBy 등 실제 필드를 따른다. 비활성화/재배정돼도 저장된 ID를 보존한다. 현재 같은 컨텍스트의 활성 사용자 또는 본인만 현재 표시명을 쓰며 그 외는 ‘이전 작성자’로 표시한다. 과거 표시명과 현재 담당자를 추정하지 않는다. 이 ID는 허용된 기록의 작성자 식별자이며 계정 상세·이메일·다른 컨텍스트 멤버십을 반환하지 않는다.

SearchList의 filters는 이미 권한 투영된 기록에서만 만든다. UI가 정적 actor 목록이나 숨은 price 필터를 합치지 않는다. ContextBar의 NotificationPulse를 이 읽기 화면에서 재사용하지 말고 contexts API와 부수효과 없는 선택기를 사용한다. 요청 세대/선택 컨텍스트가 바뀌면 늦은 성공을 버리고, 인증/권한 철회 시 기존 결과·상세를 지운다. 일시 오류는 입력 필터를 유지한다.

## 감사 저장·표시

기존 audit row/ID/원문은 변경하지 않는다. 새 AuditData.detail(schemaVersion2)은 operationId, receiptId, 실제 subject/ref, sensitivity, bounded changes를 추가한다. shared receipt의 동일 UoW 범위에서 auditOperation을 사용하며 재시도는 원 receipt를 반환한다. 하나의 행사 명령에서 행사 변경과 요청 개정이 각각 발생하면 두 감사 기록은 같은 operationId의 별도 의미다. 동일키 재시도 때 새 감사가 생기지 않는다.

AuditItem은 저장 actor/at/target, readable changes, exact versions, operationId/receiptId/eventIds를 제공한다. eventIds는 실제 생성된 domainEvent의 ID다. 없는 이벤트를 만들거나 시간으로 연결하지 않는다. 별도 알림 전달 완료로 해석하지 않는다. 영수증이 없는 기존 API는 receiptId:null이며 그 사실을 유지한다. 수정 당시 저장한 초안 본문/항목/기한·배정 변화 또는 정확 before/after version을 소비한다. legacy에 연결이 없으면 correlation/sourcePrecision=legacy_unavailable과 설명을 표시한다. 원본이 없는 과거 담당명·버전·event는 추정하지 않는다.

SQLite 0016-audit.sql은 원본 fa2491b와 동일한 바이트로 audit UPDATE/DELETE를 차단한다. SQLite migration은 0001..0016 총16개다. PostgreSQL 0016-revision-width.sql은 이미 적용된 별도 이력이므로 변경하지 않고 0017-audit.sql에서 동등한 불변 트리거를 추가한다(총17개). migration source map의 postgres_name이 이 차이를 명시하며 기존 SQL/checksum을 모두 보존한다. 동기 SQLite 관계 검사와 비동기 PostgreSQL 관계 검사는 기존 audit ID의 수정을 모두 거부한다. auditOperation은 awaited callback 전체 동안 같은 UoW에 operation/receipt 범위를 유지하고 중첩·실패 시 이전 범위를 복원한다.

## 오류·검증 경계

401은 재로그인, 권한/원본 부재는 중립404, query 오류422, known scalar 손상/읽기 실패503이다. unknown stored extra는 투영에서 무시하며 원장을 고치지 않는다. 부정확한 원본을 빈 성공으로 바꾸지 않는다. 검색 결과가 없어도 total0과 서버 성공/503을 구분한다. 페이지가 범위를 벗어나면 total/pages는 유지하고 items는 빈 배열이다.

기존 변경 API의 CAS/422/409/멱등 의미는 유지한다. UI에서 충돌을 만났을 때 미저장 의도를 유지하고 실제 최신 revision을 읽은 후 명시 재적용한다. G14가 제품별 편집 API를 새로 만들지는 않는다.

실제 단위 검사 결과는 private command evidence에 연결한다. >6개월 자료는 주입 clock을 사용해 실제 producer가 만든 합성 이력이며 실제 운영 보존기간 실증이 아니다. HTTP, 서로 다른 OS writer, 재시작/재로그인, 복사한 과거 DB, PC390/SSR/RSC/late denial, 비작성자 검증은 각각 실행 후 따로 보고한다. accepted G17 provider attempt/plan/audit를 아래 계약에 따라 읽기 전용으로 소비한다. G17 SDK·package 및 외부 호출 동작은 변경하지 않았다.

## 현재 담당 계약 추가

`assignee`는 변경자 `actor`와 다른 정확 사용자 ID 필터다. 주담당 브랜드·공동 브랜드·GSG 담당을 모두 포함한다. 허용된 관련 taskId가 있는 기록에만 현재 task 배정을 연결한다. 상품·corpus 등 독립 기록에 관련 업무를 추정해 붙이지 않는다. 현재 허용된 task 투영 후에만 assignees 옵션을 만들며 계정 전체 목록은 조회하지 않는다.

SearchHit.assignees는 `{id,label,role:primary_brand|co_brand|gsg_owner,scope:current_related_task}`이고 SearchList.filters.assignees는 `{id,label}[]`다. 상세 필드에도 ‘현재 관련 업무 주담당/공동 담당/GSG 담당’으로 표시한다. q 키워드에 이 안전 표시명·ID를 포함하며 assignee는 정확 ID로 거른다. 역사 모드에서도 **현재 관련 업무 담당** 조건이다. 당시 담당을 뜻하지 않으며 immutable actor를 바꾸지 않는다. 재배정 이후 옛 담당 필터에서는 빠지지만 원래 작성자 필터는 유지한다.

감사 assignee 필터도 허용된 관련 원본의 현재 업무 배정을 사용한다. 감사 화면이 담당 선택기를 제공할 때 동일 컨텍스트 SearchList.filters.assignees만 소비한다. AuditList.filters는 기존 actions/actors 모양을 유지한다. 조회 권한/원본이 없는 담당자는 이름·ID·count·options에 합쳐지지 않는다.


## Accepted G17 provider consumer union

- Existing `kind=analysis` and `aiAnalysisRun` exact history remain unchanged. After canonical current original/reference ACL, a run contributes its model, each attempt's intent/dispatched/settled or interrupted phase, timestamps, safe issue/message, schema/grounding state, actual token counts and explicitly estimated USD cost. Unknown usage/cost remains `확인 불가`, never zero. No raw candidate, key, endpoint configuration or new attempt search kind. The source URL selects the exact run and displays its whole attempt history; it does not promise isolated outcome selection.
- `ai.provider.settings` requires current audit and GSG AI-manage authorization. History reads the immutable audit's strict before/after booleans and real setting target relation, not the setting's current value. Its source precision is `record_only`, with no fabricated setting version/link. Stored author ID remains the author after deactivation.
- `ai.provider.finished` requires a currently authorized exact run plus outcome → attempt → run/context/plan mutual binding. Actual outcome/attempt IDs and bounded issue/schema/grounding fields are shown; `versions` points to the exact run. Native catch paths that did not create an audit remain absent from audit, even though their outcomes appear in run history.
- New settings commands inherit the already stored same-UoW receipt operation; async finished events have their own stored operation and null receipt. Old events without detail remain `legacy_unavailable`, including when an explicit stored outcome yields an exact run link. No receipt inference from matching result IDs, backfill, or nearest/latest fallback.
- Brand receives no provider existence/count/status. Current GSG without product-price permission can read authorized AI token/cost records; private-price-only product/import events remain excluded before match/count/options/order. Read paths do not invoke config/environment lookup, transport, retries, notifications or writes. Known malformed scalar/relations return controlled503; unknown extensions do not enter output/matching.
- Validation P04 separates actual producer PDF submission/extraction/provider run → independent current text version and current reauthorization from an injected invalid original-scope fault. No supported per-file GSG revocation command exists within one context. Such a storage fault is not claimed as an operator revocation feature; actual membership changes are checked separately.
