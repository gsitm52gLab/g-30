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


## G07 independent OOXML namespace compatibility repair — state99

Valid prefix aliases with identical namespace URI/local names and equal expanded XML trees remain standard XLSX input. Eight original/diagnostic pairs preserve ZIP entries, expanded XML tags/attributes/text/children. The root reviewed original HTTP422 and ExcelJS failure; namespace-only diagnosis passes but does not close original fixture. Repair must use namespace semantics consistently in guards, raw numerical/formula/resource accounting and decoder, preserving security/precision limits and original source hash. This is a supported input compatibility correction, not a native Excel operational compatibility claim. Primary reference: https://www.w3.org/TR/xml-names/ sections2.1/6.


## G09 1:1 participant default — state100

원안8절·PRD09의 1:1 문의에 대해 브랜드 시작 사용자와 현재 해당 컨텍스트 GSG 운영팀이 참여하는 기본값을 정한다. 같은 브랜드/컨텍스트라는 이유만으로 다른 브랜드 사용자에게 대화를 공개하지 않는다. 업무 연결·담당자 변경은 문의 참여자 변경이나 G05 제출 변환이 아니다. 원 작성자/메시지/파일/해결 이력은 보존하고 비활성·권한 철회 직후 구독/재조회/파일도 제한한다. 이는 위임받은 설계 기본값이며 사용자가 별도로 승인한 정책이라고 주장하지 않는다. 구현 계약은 private G09/1/participant-policy-decision.json을 소비한다. 실제 구현·검증은 아직 NOT_RUN.


## G08 progresses independently of G07 repair — state101

G08 dependencies are accepted G04/G05 with G06 in37b ancestry; G07 is not a prerequisite. Earlier planned G07-first union is a scheduling preference, not a completion requirement. With G08server/UI frozen while G07V02 is under repair, assemble/verify G08 first at accepted37b plus its own candidates. No unaccepted G07 source is consumed. If G08 is accepted first, author-resolve its common-schema/policy union with G07 in a new candidate before independent G07 verification and integration. Both features coexistence remains mandatory in G07/G18, original failures retained.

## 2026-09-21T17:25:44.536886+00:00 — G09 standalone domain stage while G08 verifies
G09 dependencies G04/G05 already ACCEPTED at37b. Only new domain types/actual pure command validators and narrow unit file assigned to goals in isolated g09-contract; no shared schema/policy/lock/file/UI edits, no unaccepted sibling source. Later fullserver/UI moves to latest accepted combined base under explicit shared lease. G09 legacy task route entry narrow lease approved from actual route read. All feature AC remain NOT_RUN. G07 dd77 author repair evidence reviewed; independent and current-sibling union mandatory before acceptance.

## 2026-09-21T17:29:20.688527+00:00 — Parallel isolated G10 domain and union preflight
G10 depends on acceptedG05, so implementer may add only standalone corrections types/validators on37b while G09 has disjoint new files. Neither edits shared schema/policy/lock. G10 domain packet phrase intentional answer status means explicit reflection/resolution, not inquiry answers; clarified to author. Actual readonly G07/G08 union exposes6 source conflicts and clean-merge migration-count6 needs7; author resolution and populated both-direction upgrade required afterG08acceptance.

## 2026-09-21T17:32:28.408403+00:00 — G08 independent PASS integrated, not yet accepted
Root reviewed raw7groups, source and evidence hashes, default test IDs and current-version screenshot. Serial merge3c4e is product-identical to verified6460 across230 files. workflow assigned exact3c4e freshregression in separate g08-regression/4201/4202; no G08ACCEPTED or G07consumption before this gate. G09/G10 standalone source only stilldisjoint.

## 2026-09-21T17:37:18.952427+00:00 — First inquiry file ownership and explicit send
Root accepts minimal private conversation draft then owned per-item idempotentupload then atomic publish_first; actor-only draft excludes GSG/otherbrand/basiclist/home/events until send. This is delegated implementation choice fixing a static DTO cycle, not a user-confirmed new workflow requirement or runtime PASS. Current4 domain files may be revised; old artifacts frozen. Pure G09/G10 unit checks are not feature acceptance. G10 stored projector must not reuse strict command parsing as proof of safe positive unknown-extension reads.

## 2026-09-21T17:42:42.262885+00:00 — G08 current stage ACCEPTED
Exactcandidate6460 independent and integrated3c4e freshregression both reviewed. Currentnotice scopes, versions/read and atomic durableevent producer accepted. G13delivery/G09streams/G07coexistence/G18remain explicit; wholeGoalACTIVE. NextG07union consumes actualaccepted3c4e.


## 2026-09-21T18:06:20.632668+00:00 — G09 actual contract and bounded parallel authoring
Brand users initiate private inquiry drafts; GSG-created requests remain canonical task/notice workflows. Draft visibility is initiator-only even to GSG/admin, then explicit first publication enables current context GSG participation. This is delegated minimal design consistent with source section8, not a separate user-confirmed permission policy. Internal contract a511823 passed exact252 unit/static/build and root30blob review; actual HTTP/SSE/UI/AC remains pending. UI work may use frozen typed contract in its own worktree while the server author validates its actual runtime. Typed changes require explicit handoff deltas. G12 domain3files is independent accepted-base work; G12 actual server/UI is not implemented by those pure tests.

## 2026-09-21T18:23:37.730959+00:00 — G07 integration, preserved evidence caveat, G10 shared lease
G07 independent current-scope PASS is integrated at31cbb but awaits exact integrated regression. Two prior SQLite SHM coordination files were changed by verifier readonly backup; durable DB/WAL and all other original artifacts remain byte-identical. Preserve original hashes/caveat, never restore evidence to hide this; future inspection opens byte-copied DB/WAL/SHM only. G10 starts on latest accepted3c4e plus its own pure contract, because G07 integration is not accepted yet; no unaccepted sibling treated as accepted. Exclusive G10 common wiring lease delays G09union edits until frozen/released. G09server50eb author proof reviewed, actual UI/independentAC still pending.

## 2026-09-21T18:36:10.762111+00:00 — G07 current stage accepted
Exact f2e candidate independently verified, serial integration31cbb and actual integrated regression root-reviewed. Five AC accepted,8/19 stages. Current fresh unit259/defaultmock92+2SQLite-onlyskip/DB94; two RSC collector errors retained and bounded exact-source prior complete bodies reused fresh0, without claiming fresh capture. Previous two SHM coordination mutations remain explicit; originals DB/WAL/other artifacts unchanged. Actual businessExcel and future consumer/AI/finalG18 remain NOT_RUN. G10 common wiring lease released; G09 union can proceed after final UI review.

## 2026-09-21T18:47:03.743763+00:00 — Parallel independent checks on frozen G09 candidate
The actual807 union source347/SQL8 and exact314unit/static/build are reviewed; separate UI and server author evidence was reviewed earlier. Independent verification starts in another checkout/resources while the same frozen author finishes full integration selfchecks. This removes a self-imposed administrative wait; all user dependency/independence rules remain. Both final packets must be reviewed before root serialintegration, and changedsource invalidates the oldcandidate verdict. G12 uses accepted31 plus its ownpure164 only, with exclusivecommonlease after G09freeze; no unacceptedG09/G10dependency consumption.

## 2026-09-21T18:59:29.689526+00:00 — G12 canonical selection obligations
G12 own menu summary alone cannot satisfy AC12-01 while G05 full submit still requires every menu. Apply GSG-published menu definitions to a new immutable canonical request version in the selection transaction, with actual actor and campaign/selection/source provenance; preserve ordinary requirements and historical submissions/drafts. No brand arbitrary GSG authoring or publisher impersonation. Explicit rebase follows a changed request; approved zero-material projection can be empty without changing ordinary manual publish validation. Already-applied decline is cancellation discussion, not automatic cancellation. Conflicting concurrent requests/catalog/other campaign definitions require explicit reconciliation, never silent overwrite. Exact narrow lease paths are pending author design response; G10 UI shared entries remain separately owned. This is delegated implementation design, all actual feature AC still NOT_RUN.

## 2026-09-21T19:07:45.884158+00:00 — G09 exact integration; G12 decline and current source dates
G09 ownfinal and independent807 rawresults reviewed, serialintegration92a has352identical source/config/test/README blobs and preserves rootledger/env/userdocs. Fresh affectedregression required; unchanged full default suite reused with fresh0 instead of repeating identical large runs. G12 already-applied decline preserves externalfacts and priorrequest obligations as cancellation-review hold, removes these from current automatic materialmissing/reminders; no automatic cancel or completiongate. G16 source discovery confirms public JCIA current index lists2026-07-24 revisedalpha while oldindex lists2020; selected MHLW2025-03-10 ingredientnotice explicitly supersedes1985notification. Corpus author must verify current bodies/exactlocators/translationstatus, no oldversion assumedcurrent or expertreview claim. No actualAIcall yet.

## 2026-09-21T19:17:00.162115+00:00 — G09 accepted; local extraction starts
Five G09 AC accepted after exact807 independent and exact92a integrated regression reviewed. All352 audited source blobs equal, unchanged long tests reused fresh0; no fabricated fresh count. Current G13 delivery/G11 completion/G14search/G03home/G17API remain incomplete. Workflow now owns only isolated standalone G15 extraction + exclusive package/lock lease. G12-PRE01 actual2-mode wrong unselected product counts reproduced and repaired only in evidence/table on b3bb; original2ed red preserved, still author stage. G10 stale preview red currently being repaired.

## 2026-09-21T19:28:44.769548+00:00 — source review and bounded parallel handoff
G10UI4f953artifact/281source/56freshbrowser/79trace rootreviewed; truePRE01/02 redandrepairs retained. G12server9761184artifact/324source/38commands/293HTTPbodies/12trace rootreviewed, canonicalG07scope repaired. Neither stageACCEPTED. Begin G10 internalunion onimmutableUIwhile its evidencepackaging finishes; independent/integrationgate stillrequires bothrootreviews(nowcomplete). G12UI newroutes startedafterserverreview; sharedtaskentries/README releasedafterG10b214sourcefreeze. Onlymigration test-count/historicalfixturemembership corrections autonomouslyallowed; semanticassertions preserved. G15actualextraction separatepackagelease. OfficialpublicPDFs downloaded/hasharchived forfutureG16, not claimedfullyread/corpusvalidated.

## 2026-09-21T19:37:31.733053+00:00 — G10 independent verification and G15 server continuation
G10 exact3d57 combined author final reviewed:1299artifact hashes/405source pairs/72browser cases/72traceCRC; actual migration original bytes preserved. Independent workflow now verifies exactcandidate. G15 standalonecd648 authored workflow reviewed120artifacts/20sources/20commands/326unit and8actualextractions, no API/provider/UI claim. Goals owns G15server thenUI to leave prd independent of entireG15. Sharedschema0012 lease allocated; G12UI keepsREADME/taskentries. No product acceptance advanced, no env/API call. Root audit parser errors (Vitest format/ANSI) preserved, only parser corrected.

## 2026-09-21T19:46:48.184800+00:00 — preserve false-positive evidence and bind exact repair
Independent G10 originalcheck345P1F matched1700 onlyinside actualrandomUUID. Recursive exactprivatekey/value testrepair changesoneunitfile1512 only; author348unit, rootreviewf2eb8c77. Independent new1512checks/ownruntime required; completed3d57sameproduct/fullbrowser sourceboundreusefresh0, no entireunchangedrerun. Originalfailure stays. G12 SourceRequestNotice phrasechange narrowexistingHTTPtestliterallease granted. G16officialeGov APIv2 selectedArticle66 actual200 asof2026-09-22, revision335AC0000000145_20260521_505AC0000000063; earlierHTML0lines limitationclosedforselectedarticleonly, nofullstatute/legalexpertreview claim. JCIA58PDFspread pages needprintedpage+PDFpage exactlocator, industryvoluntaryguidance distinguished fromofficialnotice/statute.

## 2026-09-21T19:59:42.835416+00:00 — G10 exact integration and persisted OCR validation
G10 final1512 independent7groups raw reviewed3307artifacts/409sourcepairs/23commands/280traceCRC. Original345P1F UUIDfalsepositive and invocationerror preserved. Serial953 integration entire non-ledger tree identical,409source equality; exactbounded regression assigned before acceptance. G15 server21f340unit/build contractrelease reviewed33source; actualNextOCR exposed snapshot projection keyorderhash mismatch after16HTTPchecks, narrow ownmodule fix authorized, no fullendpoint claim. Read-only currentorigin ls-remote main and heads both exit0 empty; no remote main material available, nofetch/mutation, officialpublicfallback.

## 2026-09-21T20:06:45.394396+00:00 — G10 current stage accepted
Exact1512 independentlyverified, serial953 fullsourceidentical andfresh integrated348unit/coremock4DB4/HTTP17/UI14/newPID3 verified. Root461artifact/12commands/409source/12CRC andprior3307unchanged checked. Fullunchangedbrowser/cornercases/history reusedfresh0, originalerrorspreserved.10/19stagesaccepted, actualG11completion/G13delivery/G16AIproducer andG18remain.


## G16 implementation choices (state142, preparation only)

PRD16 forbids automatic brand disclosure. Analysis/result/human decisions default to GSG internal, deliberate G10 publication stays separate. A labeled synthetic adapter enables keyless demos; it never impersonates OpenAI or silently replaces live failures. Curated legal sources are deployment-owned versioned releases with reproducible publication and a read-only viewer. Old translations remain historical but stale translations are excluded from current retrieval. New migration0013 is reserved; no implementation lease until G15 is ACCEPTED. These routine choices require no extra user decision.


## 2026-09-21T22:12:49.700703+00:00 — G13 delivery and current certainty
Requested/expected date guidance preserves its certainty; only confirmed dates use confirmed deadline wording. App-open authenticated CSRF sync is the ordinary in-app delivery path, with explicit absence of closed-app cron/email delivery. Source-bound dates are edited through their producer, never silently overridden. G16 synthetic engine does not count as G17 actual OpenAI success. Narrow existing test expectation deltas preserve original denial and reseed semantics.


## 2026-09-21T23:32:14.396085+00:00 — independent test failure and provider recovery
G13 committed UI-I leaves response.json unawaited beyond page teardown. Original19P1F preserved; author owns onlytestrepair, independent exactnewcandidate closure required. G14 current sourcecontract reviewed, implementation gatedG13accepted. G17 typedserver551check/build is authorstage only; rootraised possiblebaseURLidentity/expiredclaim permanentrecovery issues foractualreproduction. H09 obsolete provider-unavailable assertion may change narrowly but actual domaincause mustbechecked. Noactualproviderclaim, noacceptance advancement.


## 2026-09-21T23:46:01.968310+00:00 — G13 accepted; G14 narrow server implementation
G13 exactf48e independently verified and integrated regression reviewed. Original19P1F preserved and testonly0c97closed4cases, freshintegration16realcases (rootoriginal12assumptioncorrectedaddendum5011). G14 begins onlyafterallsevenrequireddependenciesACCEPTED. New0016audit appendonly nolegacybackfill; optional typedmetadata andlistedproducerseams only, currentG17ai-review/service/SDK/package notowned. Finalsearch/history/price existence filters must beindependentlytested.


## 2026-09-22T00:12:50.582242+00:00 — SDK envelope boundary and typed search handoff
Independent G17-V01 uses real object:response and exposes SDK addOutputText before application metadata preservation; earlier author fixture omitted discriminator. Preserve original failing evidence, fix author-owned transport only, then new candidate independent validation. Actual configured verification call waits for repaired final path. G14 server typed7cf19 author634/check/build evidence reviewed; lease released, runtime/UI/independent still pending.


### 2026-09-22T00:41:57.725451+00:00 — G17 acceptance and G03 canonical preparation
G17 actual response/usage and error paths passed independent and integration review; no additional API call was necessary because provider source bytes were unchanged. Final legal accuracy remains unverified. G03 adopts separate all-GSG urgency and self-only delivered unread counts; Brand mine material counts; exact-submission external-use review cue without send/approval inference. G03 implementation still waits for G14 acceptance.


## 2026-09-22T01:40:45.740480+00:00 — Supabase deployment and authorized g-30 push

Latest user request selects Supabase PostgreSQL/private Storage, preserving all existing product ACs. Explicit non-force branch push permission supersedes prior push prohibition; remote main and legacy histories/data remain protected. Goal stays paused until the user restarts. execution-v3 adds SB-01~18, secure direct uploads/finalize immutable objects, bounded authorized large-file reads and actual multi-instance/Vercel acceptance. New remote main85bcb is byte-identical to historical f3f868c tree; preparation merge retains current product bytes. SUPABASE_URL/SECRET_KEY read-only Storage list succeeds; SQL URI checks pending. No implementation/runtime pass is claimed.

### State 177 — 2026-09-22 credential preflight and fail-closed supplemental guard

DATABASE_URL/Transaction pooler와 DIRECT_URL/Session pooler 모두 TLS 1.3·서버 인증서/hostname 검증을 포함한 READ ONLY SELECT 1 성공. Storage 인증 읽기 HTTP 200. public 테이블 0개, gs-hale-private 버킷 없음. 원격 데이터 변경 0회. 앱 통합/Vercel 환경변수 검증은 미실행. 첫 CA 오류 및 pooler backend SSL 지표의 진단 오류는 원본 결과에 보존했고 공식 CA와 실제 TLS 소켓을 확인하여 보완했다. 읽기 전용 연결은 SB 제품 수용 통과로 승격하지 않는다. 독립 검토에서 supplemental 설정 누락 우회를 발견해 고정 revision/경로/18 ID/필수 여부를 검사하도록 보완했다. 6개 guard 조건 검증 통과, 독립 후속 소스 검토 PASS.

### State 178 — resumed Supabase implementation contracts

실제 active Goal 재개를 확인해 paused 준비 상태를 해제한다. 원문 첨부의 이전 저장소/push 조건보다 후속 사용자 Supabase 전환·g-30·push 허용을 우선한다. DB 기반은 모든 get/list/create/update가 Promise인 AsyncUnitOfWork, 단일 pg 연결 SERIALIZABLE, async 관계검사를 사용하며 서비스 callsite 전환은 기반 독립검증 후 진행한다. Storage 허가는 staging에만, 실제 bytes 검증 후 서버 create-only finalized key로 보존한다. 인증/권한/최종 저장 연계는 별도 후속 수용이다. G14 packet의 존재하지 않는 AC-14-05는 원문 4개 AC에 맞춰 정정하고 원 packet을 보존했다.


## AUTH-DURABILITY-20260922-01 — 배포 로그인 유지 수정
사용자의 새 지시로 로그인/CSRF 공유 DB 연결을 우선 진행한다. 플랫폼 Goal 상태는 paused이며 새 Goal을 만들거나 재개했다고 보고하지 않는다. Vercel production SHA fe2932e와 storageMode mock을 사용자 인증된 브라우저에서 확인했다. 별도 mock 저장소에 동일 토큰을 조회하면 401이다. 인증만 DB로 바꾸고 보호 기능에 세션을 복사하는 방식은 currentUser/authVersion/로그아웃/정지 원자성을 깨뜨리므로 true async UoW·인증/정책·보호 소비자를 하나의 합본 checkpoint로 전환한다. 공통 인터페이스와 파일 소유권을 고정하고 분리 worktree에서 구현한다. foundation/합본 독립 검증과 통합 회귀 전에는 수용·배포하지 않는다. Storage binary/G14/G03/G18 및 나머지 SB 조건은 별도로 남긴다.
