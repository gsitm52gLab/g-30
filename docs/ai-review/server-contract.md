# G16 서버 계약

GSG 내부 합성 데모 분석입니다. 실제 provider 호출, 법률 적합성 승인, 외부 전문가 검수 또는 모델 정확도 검증을 뜻하지 않습니다. G15 읽기 완료와 G16 분석 완료는 별도 상태입니다. UI는 `src/server/ai-review/contracts.ts`의 타입을 가져와 실제 응답을 소비합니다.

## API

모든 API는 현재 세션·컨텍스트·원본/참조 권한을 서버에서 확인합니다. POST에는 기존 Origin 및 `X-CSRF-Token`이 필요합니다. JSON 응답은 no-store이며 오류는 기존 `{error:{code,message}}` 형식입니다. 브랜드에는 분석 목록·결과·raw·corpus·사람 검토 모두 비공개입니다.

| 요청 | 응답/의미 |
| --- | --- |
| `GET /api/ai-review?contextId=ID` | `AiReviewList`: 접근 가능한 입력과 접근 가능한 마지막 분석. 과거 run도 원본 권한 확인 후 투영 |
| `GET /api/ai-review/inputs/ID?versionId=ID` | `AiReviewWorkspace`: 선택한 정확 입력 버전, 완료된 추출 선택지, 분석 이력, 현행 corpus, 엔진/기능/제한 |
| `POST /api/ai-review/inputs/ID/start` | `{runId,detail:AiReviewDetail}`: 명시 합성 분석 생성·재시도·대기 재개 |
| `GET /api/ai-review/runs/ID` | `AiReviewDetail`: 원문 snapshot, provenance, 결과·근거·사람 검토 이력·허용 G10 대상 |
| `POST /api/ai-review/runs/ID/review` | `{actionId,detail:AiReviewDetail}`: 후보 수락/수정/기각을 별도 불변 action으로 저장 |
| `GET /api/ai-review/runs/ID/raw` | `AiReviewRaw`: 정확 저장 raw 문자열과 hash, GSG 내부 전용 |
| `GET /api/ai-review/corpus?contextId=ID&releaseId=ID` | `AiReviewCorpus`: 해당 불변 release, 현행 여부·현행 ID. 배포 소유 읽기 전용 |

start 요청은 workspace의 실제 값으로 구성합니다. UUID와 서버 ID를 사용하며 예시의 괄호 문자는 전송하지 않습니다.

```json
{"inputVersionId":"<workspace.inputVersionId>","extractionRunId":"<workspace.extractionOptions[0].id>","expectedRunId":null,"corpusReleaseId":"<workspace.corpus.id>","corpusManifestHash":"<workspace.corpus.manifestHash>","engine":"synthetic_demo","idempotencyKey":"<new UUID>"}
```

`expectedRunId`는 선택 입력 버전의 마지막 run ID 또는 첫 실행의 null입니다. 응답을 잃으면 같은 body/key로 재시도합니다. 새 실행 의도는 새 key와 새 마지막 run ID를 사용합니다. 대기 run은 같은 body/key로 재개할 수 있습니다. corpus가 바뀐 대기는 현행 workspace 기준 새 body/key와 이전 run ID로 명시 대체합니다. 서버는 이전 대기를 실패 이력으로 보존합니다. 동시 2개, 대기 16개, 실행 lease 90초, 동일 입력·추출·corpus의 연속 실패 재시도 상한 3회입니다. 금액 제한이 아닙니다.

```json
{"findingId":"<finding.id>","expectedRevision":0,"decision":"accept","reason":"원문과 근거를 확인하여 후보를 수락합니다.","editedSuggestion":null,"idempotencyKey":"<new UUID>"}
```

초기 `expectedRevision`은 0, 이후에는 finding.review.revision입니다. `edit`는 비어 있지 않은 `editedSuggestion`, `accept`/`reject`는 null이 필요하며 모든 판단에 사유가 필요합니다. 최초 검토 뒤 revision은 저장된 실제 값(현재 2)을 사용하고 숫자를 증가 추정하지 않습니다. `review.current/history`의 현재 판단과 불변 이력을 구분합니다. 원문·원결과는 자동 수정하지 않습니다.

## 화면에 그대로 유지할 의미

- 결과 `status`는 candidates/no_candidates/unconfirmed/out_of_scope/unread이고 `legalApproval:false`, `requiresHumanReview:true`는 항상 유지합니다. 후보 0은 승인 0건이 아니라 후보가 없다는 뜻입니다.
- `snapshot`의 읽은/못 읽은 범위, 인용의 `original.locationGranularity`, 페이지·좌표·UTF16 범위를 함께 표시합니다. segment box는 글자 단위 좌표로 표현하지 않습니다.
- `risk`와 `confidence`는 별도입니다. `legalBasis`(법령/공식 통지)와 `supportingGuidance`(업계 자율 지침)는 별도입니다. unknown citation은 근거 확인 완료로 표시하지 않습니다.
- 일본어 원문과 한국어 정렬은 별도 버전/hash입니다. 한국어 `machine_unreviewed`, `unofficial:true`를 표시합니다. `staleExcerptIds`와 `corpusIsCurrent`는 과거 결과의 현재성 표시이며 과거 결과/번역을 덮어쓰지 않습니다.
- `availableEngines/defaultEngine/engineLabel/providerCalled`가 실제 실행을 설명합니다. 현재 합성 엔진만 존재하고 providerCalled=false입니다. G17은 실제 dispatch/attempt 근거를 기록해야 하며 engine 이름으로 호출 여부를 추론하면 안 됩니다.
- 실행/검토 중 선택 버전 변경, 늦은 응답, 권한 철회는 UI가 generation 및 선택 ID 일치를 확인해야 합니다. 401/403/404는 보호 상태를 비우고 재요청/자동 생성으로 되살리지 않습니다.
- G15 detail/sourcePicker의 analysis는 GSG에 `connected:true,status:GSG_INTERNAL,url,providerCalled:false`를 반환합니다. 상세 URL은 `/ai-review/inputs/[id]?context=...&versionId=...`, 목록은 `/ai-review?context=...`입니다. 브랜드에는 실행 유무와 무관한 `connected:true,status:RESTRICTED,url:null,providerCalled:false`만 반환합니다. 실제 분석 상태는 G16 API에서 조회하고 G15 추출 완료와 구분합니다.

## G10/G11 생산자

finding.correctionTargets는 실제 G05 제출 본문/short_text/long_text의 정확 원문과 같은 입력, 또는 실제 제출 파일에서 읽은 후보에만 존재합니다. 단순 제출 연결·상품 연결만으로 답변을 추정하지 않습니다. 수락/수정된 후보를 사용자가 명시적으로 기존 G10 save_opinion/record_review 명령의 `source:{kind:'ai_candidate',runId,findingId}` 및 서버 제공 target으로 연결합니다. G10 수정취합의 공개 미리보기/공개는 별도 행동입니다. 사람 검토만으로 의견이나 공개본을 자동 생성하지 않습니다.

G11 현재 GSG basis는 실제 run/result/review/action/source/corpus 행 revision을 포함하여 basisCAS를 검증합니다. AI 실패·미검토·stale는 잔여 정보이고 GSG 수동 완료의 강제 승인 게이트가 아닙니다. 브랜드 basis/history의 AI 필드는 숨겨진 수/실패/ID와 무관한 일정한 unavailable 표현입니다. 과거 `not_connected` 불변 snapshot을 다시 쓰지 않습니다.

## 배포 corpus

```sh
npx tsx scripts/ai-review-corpus.ts inspect /absolute/path/own.sqlite
npx tsx scripts/ai-review-corpus.ts publish /absolute/path/own.sqlite CURRENT_RELEASE_ID /absolute/path/validated-release.json
```

최초 publish는 `CURRENT_RELEASE_ID` 대신 `NONE`입니다. CLI는 .env·키·network를 읽지 않습니다. 게시물은 1MiB 기술 제한, 명시 expected-release CAS, strict manifest/hash/버전 불변 검증을 적용합니다. 새 source 내용에는 새 source version ID와 일치한 번역/version/hash가 필요합니다. 반복 seed는 기존 현행 head를 복구/덮어쓰지 않습니다. 배포자가 검수한 release 입력을 게시하며 임의 사용자 corpus 편집 API는 없습니다.

## 안전한 오류와 복구

| 코드/상태 | 복구 |
| --- | --- |
| 401/403/404 | 현재 접근 불가. 보호 내용을 비우고 정상 로그인/허용 컨텍스트를 확인 |
| VALIDATION/ENGINE_UNAVAILABLE 422 | 입력 및 명시 지원 엔진 확인; provider 자동 대체 없음 |
| EXTRACTION_NOT_READY 409 | 정확 선택 버전의 G15 읽기 완료 후 선택 |
| CONFLICT/RUN_ACTIVE 409 | 현재 실행/검토 revision을 새로 조회. 사용자 작성 이유/수정안은 transient 실패에서 보존 |
| CORPUS_CHANGED/SOURCE_CHANGED 409 | 원본·현행 corpus를 다시 확인하고 명시 새 실행 |
| RETRY_UNAVAILABLE 409 | 반복/구조 오류 확인. 새 읽기 또는 corpus 없이 자동 반복하지 않음 |
| FINDING_REVIEW_REQUIRED 409 / TARGET_MISMATCH 422 | 후보 수락/수정 후 서버 제공 정확 제출 대상 선택 |
| RESULT_INVALID 422 | 구조·원문 위치 오류. 실패 run 보존, 성공/후보 0으로 표시 금지 |
| ENGINE_ERROR/QUEUE_FULL/STORAGE_UNAVAILABLE/CORPUS_UNAVAILABLE 503 | 안전 오류 표시와 명시 재조회. raw 내부 예외/원장 중첩값 노출 없음 |

초기 계약 검증은 합성/저장 계약 검사입니다. 실제 provider, 법률 전문가 정확도, 브라우저 및 HTTP/재시작 검증은 별도 증거가 있어야 완료로 표시합니다.

## 자체 검증 실행

각 명령은 합성 데이터와 독립 `.local` 경로를 만들며 실행한 프로세스를 종료합니다. 포트는 명시 재할당할 수 있습니다. 실제 `.env` 및 provider를 사용하지 않습니다.

```sh
npm run check
npm run build
AI_REVIEW_MODE=mock E2E_PORT=4229 E2E_AUX_PORT=4230 AI_REVIEW_REPORT=/absolute/own/mock.json npx tsx scripts/verify-ai-review-http.ts
AI_REVIEW_MODE=sqlite E2E_PORT=4229 E2E_AUX_PORT=4230 AI_REVIEW_REPORT=/absolute/own/sqlite.json npx tsx scripts/verify-ai-review-http.ts
AI_REVIEW_HISTORY_REPORT=/absolute/own/history.json npx tsx scripts/verify-ai-review-history.ts
```

HTTP 검증의 SQLite 마지막 두 사례는 전용 DB에 unknown extra 및 손상된 scalar를 명시 주입합니다. 과거DB 검증은 accepted0804 소스를 Git export하고 그 실제 생산자로 만든 DB/파일을 닫은 다음, 파일시스템 복사가 끝난 후에만 복사본을 SQLite로 엽니다. 원본 DB/파일은 수정하지 않습니다. 정확도·전문가 검수·G17 provider·독립검증을 이 자체검사로 대체하지 않습니다.
