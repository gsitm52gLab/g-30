# RUN-20260921-01 실행 결정

- 최신 첨부 Goal을 읽고 전체 19개 모듈·91개 AC를 유지한다.
- 초기 저장소 main은 커밋 전, origin은 보존한다. 이번에 원격 fetch/push는 하지 않았다. 약기법 main 자료는 AI 구현 단계에서 확인한다.
- v2 문서의 확장된 fetch 규약은 사용자 정정 후 미확정 초안이다. 사용자 요청의 한 문장 범위만 적용한다.
- G00 기반 완료는 최소 저장 adapter/migration/seed/재시작 증거다. 후행 UI·권한을 미리 통과 처리하지 않는다.
- 실제 세션 로그는 접근 가능한 원본을 찾은 경우에만 원본으로 기록한다.

## G01 계약 기본값 (구현 전 결정)

- G00의 단일 RecordRepository/UoW를 유지하고 G01이 typed record 종류와 관련 migration을 단독 소유한다. 초대·중지·재배정·감사는 같은 트랜잭션에서 저장한다. SQLite 제약과 mock 검사는 동일 불변조건을 적용한다.
- gsg/brand 신원 유형과 관리자 grant를 분리한다. 관리자 범위는 explicit all/selected contextIds, 내부 가격 권한도 명시적으로 저장한다. 사용자 role만으로 자동 승격하지 않는다.
- 세션 8시간·pre-auth 15분·초대 48시간을 초기 기술 기본값으로 사용하며 테스트 clock으로 만료 경계를 검증한다. worktree마다 별도 쿠키 이름·DB·포트를 배정한다.
- 기존 합성 fixture ID와 task의 userId 배정을 보존하고, 동일 컨텍스트 활성 membership 관계를 검증한다. 초대는 복사 링크이며 실제 이메일 발송이 아니다.
- G01/G02 준비 문서는 테스트 계획이다. 모든 제품 검사·AC는 실제 검증 전 NOT_RUN이다.

## G04 이후 연결 계약 (준비 검토, 실행 결과 아님)

- G04가 실제 참고자료 업로드·비공개 파일 저장·서버 권한·다운로드의 최소 공통 core를 소유하고 G05가 제출/다중 업로드/재시도/정확 버전 재사용으로 확장한다. 임시 공개 URL을 제품 파일 기능으로 인정하지 않는다.
- G04 요청 변경은 저장된 이전 제출 계약 fixture를 실제 변경 API 전후로 비교한다. 실제 G05 제출 생산자 연결은 D06에서 추가 회귀하며, G04 outbox와 실제 G13 알림 연결은 D07에서 검증한다.
- G04 개별 완료와 실제 G11 프로젝트 수동 완료의 분리는 D08에 남긴다. 초기 계약 검사가 아직 없는 후행 기능 통과를 뜻하지 않는다.
- G06 공통 상품 모델 이행을 한 작성자가 먼저 고정한 뒤 G05가 accepted 상품 snapshot 계약을 소비하는 순서를 우선한다. 두 작업의 공통 schema/seed/lockfile 동시 편집은 하지 않는다. 이 실행 순서는 기존 DAG의 완료 조건을 축소하지 않는다.
- G06은 기존 Product ID/task.productIds를 보존한다. contextId를 공통 상품으로 이행할 때 null을 공개 권한으로 취급하지 않고 허용 ContextProduct를 먼저 확인한다. G04의 기존 task/product 연결 회귀를 필수로 포함한다.
- G06/G07 준비 문서는 구현/검증 NOT_RUN이다. 실제 착수 후보에서 계약을 재확인하고 원문의 허용 행동을 새 설계 제약으로 임의 축소하지 않는다.

## G09 부분 홈 연결과 G03 전체 홈 통합

- G09의 AC-09-01은 실제 문의 생산자와 현재 GSG 홈의 질문/답변/외부대기 집계 및 관련 화면 이동까지 G09에서 구현·독립 검증한다. 해당 홈 컴포넌트 경로만 좁게 소유권을 배정한다. 질문5/답변4/외부대기1을 단순 서비스 함수 결과로 대체하지 않는다.
- G03은 G09를 포함한 모든 선행 생산자가 ACCEPTED인 뒤 양측 홈 전체 집계·우선순위·내비게이션·반응형을 통합한다. G09가 전체 G03 완료를 요구하지 않으므로 DAG는 유지되며, G09의 필수 홈 증거를 G18로 미루지 않는다.

## G04 외부 일정과 확인 상대 누락 보충

- 원안 `source-planning-v3.md` 5.2절의 외부 일정(117~119행)과 11절(214행)을 근거로 G04 요청 작성에 선택적 신청/검토/인쇄·납품/게시·사용 일정 및 외부 확인 상대를 추가한다. 브랜드 회신/자료 제출 마감과 별도로 날짜·시간대·확정 수준·출처/버전을 저장하고 공개 범위를 적용한다.
- 외부 확인 상대는 업무 기록이며 로그인 계정/실제 발송 기능을 만들지 않는다. G13의 전체 일정 집계·충돌 표시·독촉 책임은 유지한다. 이는 초기 패킷의 누락 보충이며 원안 확대나 이미 수행한 제품 검증이 아니다.

## G06 상품 사용본의 실제 제출 연결

- ContextProduct는 `(contextId, productId)` 고유이며 컨텍스트와 상품의 브랜드가 일치해야 한다. 원안의 컨텍스트별 상품 정보를 실제 관계 제약으로 명시한다.
- D09에 G05 실제 제출의 상품 공통/컨텍스트/소비자가/파일 버전 고정과 이후 G06 변경에도 이전 제출 불변 검사를 추가했다. 기존 제출·파일의 후행 소비 의무를 상품 버전까지 명시한 것으로 기능 범위 확대가 아니다. G06 초기 저장 fixture 검증과 G05 실제 생산자 검증을 구분한다.

## G06 공통 공개 정보 편집 권한 (구현 전 설계 결정)

- 현재 허용된 ContextProduct 관계 하나와 최신 product.edit 권한을 가진 활성 브랜드/GSG 사용자는 명시된 공개 공통 필드를 수정할 수 있다. 업무 담당 여부를 요구하지 않는다. 공통 현재값이 다른 연결 컨텍스트에 반영되는 것은 공통 원장의 의도된 효과이며, 그 컨텍스트의 SKU·상태·가격·파일 접근/변경 권한은 확대하지 않는다. 이는 원문의 상세 미정 부분에 대한 위임 설계 결정이다.
- 영향 안내는 상시 공유 설명과 열람 가능한 적용 범위만 표시한다. 전체/숨김 건수·타컨텍스트 식별/가격/파일은 반환하지 않는다. 공통 변경 이력도 공개 필드와 안전한 작성자 표시만 제공한다. 상품/브랜드 식별자·관계·가격·파일·서버 메타는 공통 patch에서 제외한다.
- 모든 연결 관계의 코드 중복·동시 변경은 원자적으로 검사하되 숨긴 충돌 정보 없이 중립적 conflict를 반환한다. 공유 데이터 변경이나 제약 성공/실패를 통한 모든 추론 가능성까지 차단했다고 주장하지 않는다.
- 원본/참조 파일 권한은 모두 현재 검사하며 같은 브랜드/새 컨텍스트 연결만으로 공유하지 않는다. 모든 새 응답은 중첩 객체까지 명시 allowlist로 구성한다. G04-V03의 저장된 확장필드 반례를 상품 출력 검증에도 포함한다.
- 세부 제안 및 근거는 private G06/common-edit-decision-options.md와 task-draft revision3. 아직 G06 구현·검증은 NOT_RUN이고 G04 ACCEPTED 뒤 실제 기준 SHA/소유권을 고정한다.

## G06 material counts and document/capture boundary

Original7.1 requests material counts, not a substitute task count. Before the actual G07 evidence producer, requested/missing/unconfirmed material counts are null and explicitly unconnected. Related task count can be separately labeled. SA22 aggregate completion remains G07/G18. G06 retains supplied basic document metadata in versioned context bindings; applicability decisions and certification status are G07. Exact product-use capture must describe retail effective intervals and explicit version selection, without private supply metadata. This is an implementation sequencing decision, not a product PASS. See private G06/1/contract-clarification-1.json.


G05 delegated defaults (state66): exact requestId/requirementKey/productId identity, shared draft CAS and consumed-draft uniqueness; one canonical typed evaluator; providedBy/recordedBy/uploader separate. Paused draft save permitted, explicit submit waits resume; GSG manual completion remains unblocked. Request OR immutable-submission file release plus original AND reference authorization; upload/draft is not publication. Scoped sessionStorage recovery required for failed-save+refresh, no raw file bytes/auth secrets. Preparation decisions and formal packet hold complete rationale.


## G07 evidence and Excel implementation decisions

- Accepted37b baseline. Immutable Evidence metadata/source and independent per-product assessment. Current inventory, actual G05 submission, and human application assessment are distinct. Human N/A notes cannot waive canonical required requests; explicit request change required.
- Standard XLSX batch has one explicitly selected context verified in every row; other contexts use separate batches, no implicit relationship creation. Any row error blocks the entire batch. New/update/skip, preview and explicit apply are distinct.
- Single synchronous UoW product mutation adapter preserves common/context/price versions, provenance, audit, batch and one receipt. Current price permission is separate. Export constructs a new allowlisted workbook.
- External workbook/OLE, macros and formula execution unsupported. Ordinary hyperlink display/URL is read without execution/fetch and validated by mapped field. Actual business Excel NOT_RUN remains distinct from standard functionality.
- One server schema/migration/policy/lockfile writer. Root reviews actual typed contract commit before separate UI assignment; internal contract freeze is not checkpoint acceptance.

G07 pre-freeze clarification: only complete exact historical submission addresses carry requestId/submissionId/requirementKey/productId. Ordinary current-request navigation must not look like an incomplete historical address. Evidence application confirmation is a file/product relationship; it does not clear canonical human content/specification pending. Preserve that pending status/count without adding G10 review implementation. Source review findings G07/1/main-provisional-contract-review.json; runtime NOT_RUN.

## G08 notice target eligibility — 2026-09-21

One notice has one explicit country×retailer×brand context. “All active brand members” is a current eligibility rule; a publish-time recipient snapshot does not permanently exclude legitimate members who join later. Every read/file path still requires current context membership and eligibility under both current publication and the requested historical version. Target changes publish a new immutable version. A selected-user mode is not mandatory; if supplied, an empty selection means no recipients, never all. Version-specific read receipts do not mark the next revision read. This is a delegated design decision applying PRD-08, not completed verification.
