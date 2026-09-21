# GS HALE

**Healthcare & Aesthetic Launch Enablement** · **해외 헬스케어 진출의 모든 일**

현재 후보는 G00 실행·저장, G01 컨텍스트·사용자, G02 서버 권한 기반에 **G04 업무 요청·프로젝트·참고자료**를 연결합니다. 합성 자료로 로그인, 컨텍스트 관리, 초대 수락·재발급, 계정/멤버십 중지·재배정, 신규 입점/스팟 요청 작성·공개·버전 변경과 파일 업로드를 제공합니다. 현재 화면과 API는 중앙 서버 정책과 명시적 필드 투영을 사용합니다.

G04의 실제 업무·참고파일 API/HTML/RSC와 후행 채널의 정책 harness는 구분합니다. G06 독립 상품과 정확한 사용본에 이어 이 후보는 G05 실제 답변 서버 계약을 추가합니다. 답변 UI는 별도 작업에서 연결하며 증빙·Excel, 검토·완료·문의·AI의 완료를 뜻하지 않습니다. 기존 prior-submission fixture는 계약 예시로 보존하고 새 실제 제출과 구별합니다. 외부기관 계정, 실제 이메일 발송, 실제 AI API 호출은 없습니다.

## 설치·실행

Node **24.x**, npm **11.x**를 사용합니다. 명령은 해당 worktree 루트에서 실행하며 다른 프로젝트의 node_modules·DB·환경파일을 연결하지 않습니다. API 키와 실제 `.env` 없이 실행할 수 있습니다.

```bash
npm ci
npm run dev:mock
```

`http://127.0.0.1:3000/login`에서 로그인합니다. 합성 관리자 이메일은 `admin@example.test`, 비밀번호는 `Demo-Hale-2026!`입니다. 같은 공개 합성 비밀번호를 사용하는 `luna@example.test`는 두 컨텍스트 브랜드 멤버, `operator@example.test`는 관리자 권한 없는 GSG 운영자, `selected@example.test`는 하나의 컨텍스트만 관리하는 관리자입니다. `co@example.test`와 `price@example.test`는 브랜드/GSG 재배정 대상입니다. 이 공개 fixture는 시연 전용이며 실제 서비스 계정으로 쓰지 않습니다.

`npm run build` 후 `npm start`로 production 빌드를 확인합니다. 일반 `npm run dev`/`npm start`의 기본 포트는 3000입니다. 별도 포트를 쓰면 `APP_ORIGIN=http://127.0.0.1:<port>`와 고유 `SESSION_COOKIE_NAME`을 함께 지정하세요. 허용 Origin은 서버 설정과 정확히 같아야 하며 브라우저의 임의 Host/role 값을 인증 근거로 쓰지 않습니다. HTTPS Origin에서는 Secure 쿠키를 사용합니다.

mock은 메모리 저장으로 재시작 시 fixture로 초기화됩니다. 영속 시연에는 SQLite를 사용하세요.

## SQLite와 기존 G00 자료

```bash
DATABASE_FILE=.local/data/gs-hale.db npm run db:migrate
DATABASE_FILE=.local/data/gs-hale.db npm run db:seed
DATABASE_FILE=.local/data/gs-hale.db npm run dev:db
```

`db:setup`은 migration과 seed를 순서대로 실행합니다. 적용된 SQL의 SHA-256을 기록하고 변경을 거부합니다. G00의 `0001`은 그대로 보존하고 `0002-identity.sql`이 종류별 고유 인덱스와 관계 검사를 추가합니다. 시작 시 DB migration/seed를 자동 수행하지 않으며 DB가 없거나 실패하면 503/저장 오류를 표시하고 mock으로 전환하지 않습니다.

seed는 누락된 합성 fixture ID만 추가하고, **명시적으로 알려진 G00 fixture**의 누락된 인증·컨텍스트·작성자 필드만 보강합니다. 사용자가 바꾼 상태·담당자·추가 레코드·기존 credential을 덮어쓰지 않습니다. 알 수 없는 기존 사용자를 자동으로 active/admin으로 승격하지 않습니다. DB 초기화 명령은 없습니다.

## 인증·상태·저장 계약

- 신원은 정규화된 이메일(앞뒤 공백 제거·소문자) 하나이며, 점/플러스 주소를 추측해 병합하지 않습니다. 멤버십은 `(contextId,userId)` 하나입니다. `gsg/brand` 행위자와 관리자 grant는 별도이며, 관리자는 `all/selected contextIds`와 명시적 가격 접근 값을 가집니다.
- 비밀번호는 서버의 scrypt-v1 해시/랜덤 salt로 저장합니다. 세션/초대 원문 토큰은 저장하지 않고 SHA-256만 저장합니다. 세션은 HttpOnly·SameSite=Lax 쿠키이며 절대 8시간, preauth는 15분, 초대는 48시간입니다. CSRF 토큰과 Origin 검사를 모든 현재 변경 API에 적용하고 로그인/수락 시도를 제한합니다. 본문은 허용 키와 최대 길이를 검사합니다.
- 새 계정은 초대 수락 때 비밀번호를 설정합니다. 기존 계정은 **초대받은 동일 계정으로 로그인**해야 다른 컨텍스트 초대를 수락하며 기존 비밀번호/전역권한은 바뀌지 않습니다. 링크는 fragment로 전달하고 수락 화면 진입 후 주소에서 제거합니다. 실제 메일은 보내지 않고 복사 가능한 링크를 제공합니다.
- 같은 pending 초대의 반복 요청은 `ALREADY_INVITED`로 거부하여 성공한 첫 링크를 유지합니다. 명시적 재발급만 이전 링크를 철회합니다. 만료·철회·소비된 링크는 수락할 수 없으며, 이미 철회한 초대를 다시 재발급할 수 없습니다. 초대 대기 멤버십의 직접 중지/활성화는 거부하고 수락을 통해 활성화합니다.
- 전역 중지는 기존 세션을 즉시 철회하고 authVersion을 올립니다. 복구 후에도 옛 쿠키는 살아나지 않습니다. 멤버십 중지는 해당 컨텍스트만 차단하고 다른 활성 컨텍스트는 유지합니다. 관리자 grant는 멤버십과 별도이므로 관리자 계정 전체 중지는 all-scope 관리자가 수행합니다.
- 중지는 진행 업무의 브랜드 담당자와 GSG 책임자를 모두 확인하여 재배정 필요를 표시합니다. 자동 배정은 하지 않습니다. 동일 컨텍스트의 활성 사용자/멤버십을 역할에 맞게 명시 선택하며 현재 assignee/owner만 바꾸고 author/contributor 이력을 보존합니다. 변경 전후·시각·기록자를 감사에 남깁니다.
- `RecordRepository`의 Promise 조회와 동기 `UnitOfWork` 계약을 유지합니다. 하나의 transaction에서 최신 권한·상태·revision을 확인하고 신원/멤버십/초대/세션철회/배정/감사를 원자 저장합니다. 해시 등 비동기 작업은 transaction 전에 수행하고 저장 직전에 다시 확인합니다. async callback/escaped UoW는 거부합니다. stale revision/고유 충돌은 409이며 실패는 전체 rollback입니다.
- 공개 경로는 `/login`, `/invitations`, 인증 부트스트랩 API와 데이터 없는 `/api/health`입니다. 일반 응답/감사에는 credential, session, 초대 토큰 해시를 포함하지 않습니다. 초대 생성/재발급 응답만 생성된 원문 링크를 한 번 제공합니다.

## 검증

```bash
npm run check
npm run build
npm run db:restart
npm run identity:races
npm run identity:restart
npm run test:install
npm run test:e2e
npm run test:e2e:db
```

`npm run verify`는 브라우저 설치를 제외한 위 검사를 순서대로 수행합니다. `check`는 lint·typecheck·단위 테스트이며 mock/SQLite의 정상·반례·시간 경계·권한·원자 rollback을 포함합니다. `identity:races`는 서로 다른 네 자식 프로세스로 SQLite 중복 이메일 초대와 동일 초대 수락을 경합시킵니다. `identity:restart`는 production 서버 A를 실제 종료한 뒤 같은 DB의 서버 B에서 새 로그인·멤버십·대기/소비 초대·철회 쿠키·재배정/작성자/감사 보존을 HTTP로 확인합니다. `db:restart`는 별도의 G00 최소 adapter 검사입니다.

`test:e2e`와 `test:e2e:db`는 `scripts/run-e2e.ts`를 통해 desktop → mobile 순서로 실행합니다. 설치된 Playwright CLI의 `--list`로 실제 선택된 테스트를 먼저 확인한 뒤, 각 프로젝트의 테스트 파일(spec)마다 새 production 서버·DB/메모리 fixture·파일 저장 경로·쿠키 이름을 사용합니다. 서로 다른 파일의 정상 로그인 횟수가 한 서버의 인증 제한에 누적되지 않으며 제품의 인증 제한과 테스트 assertion은 그대로입니다. 기존 파일/줄 번호·grep·grep-invert 선택을 유지한 채 설정의 정확한 파일 조건을 교집합으로 적용하고, 실행 결과의 test ID를 최초 선택과 대조하여 누락·중복·추가 선택이면 실패합니다. `verify`도 이 격리 명령을 사용합니다. `npm run build`와 Chromium 설치를 먼저 완료하세요.

기본 `E2E_PORT=4111`을 각 프로젝트가 순서대로 사용하고, `E2E_AUX_PORT`를 지정하면 mobile은 그 포트를 사용합니다. 지정하지 않으면 `E2E_PORT`와 같습니다. 사용 중인 서버를 재사용하거나 종료하지 않습니다. 테스트마다 다른 사용자의 작업 서버와 충돌하지 않는 예약 포트를 지정하세요. 각 서버의 `APP_ORIGIN`과 고유 쿠키 이름은 실행기가 포트/프로젝트로 설정하며 제품 기본 포트 3000은 유지됩니다. DB는 `.local/e2e-<mode>-<run-id>/<project>/<순번-spec>/fixture.db`, 파일은 같은 디렉터리의 `files/`에 보존됩니다(mock의 DB 경로는 예약만 하고 DB 파일을 만들지 않음).

CLI는 `--project=desktop`, `--project mobile`을 지원하며 반복 옵션으로 둘을 선택할 수 있습니다. 프로젝트를 생략하면 둘 다 실행합니다. 테스트 파일/행, `--grep`/`--grep-invert`, `--list`, `--headed` 등 나머지 인자는 shell 조합 없이 Playwright에 전달합니다. 잘못된 프로젝트·옵션·무일치 필터와 테스트 실패는 nonzero exit입니다. 격리를 우회하는 `--config/-c`, `--reporter`, `--output`과 상주 `--ui`는 명시 거부합니다. 보고서/산출물은 환경변수로 지정하세요. 직접 `npx playwright test` 대신 아래 wrapper 명령을 사용합니다.

```bash
# 기본 전체 실행: desktop과 mobile의 모든 시나리오
E2E_PORT=4149 E2E_AUX_PORT=4150 npm run test:e2e
E2E_PORT=4149 E2E_AUX_PORT=4150 npm run test:e2e:db
# 요청한 프로젝트/파일/테스트만 실행; 인자는 -- 뒤에 지정
E2E_PORT=4149 E2E_AUX_PORT=4150 npm run test:e2e -- --project=mobile tests/e2e/foundation.spec.ts --grep 'brand and home'
# 테스트 목록만 조회하며 서버/DB는 만들지 않음
npm run test:e2e -- --project desktop --list
# 실행별 보고서/trace 위치 지정
E2E_PORT=4149 E2E_AUX_PORT=4150 E2E_REPORT=.local/review/e2e.json E2E_ARTIFACTS=.local/review/artifacts npm run test:e2e
```

`run-id`는 UTC 시각+무작위 접미사입니다. `E2E_REPORT=/path/e2e.json`이면 `/path/e2e.<run-id>.summary.json`에 명령·cwd·exit·건수·서버 PID/종료·DB/파일/쿠키 경로를 기록하고, 프로젝트 집계 JSON은 `e2e.<run-id>.desktop.json`과 `e2e.<run-id>.mobile.json`입니다. 원본 CLI 선택은 `.<project>.discovery.json`, 파일별 원본 결과는 `.<project>.<순번-spec>.json`에 보존합니다. summary의 `projects[].files[]`에는 파일별 명령·선택 ID·PID·종료·실행 건수와 selection 검증을 기록하며, 실행 전 실패로 보고되지 않은 선택 항목은 `not_run_test_count`로 남깁니다. 기본 prefix는 `.local/e2e-results.json`입니다. 콘솔이 정확한 summary 절대경로를 출력합니다. `E2E_ARTIFACTS=/path/artifacts`이면 `/path/artifacts/<run-id>/<project>/<순번-spec>/test-results/`에 trace/화면을, 그 상위에 `runner.log`·`server.log`를 남깁니다(기본 root `test-results`). 프로젝트·파일·재실행 사이에 원본을 덮어쓰지 않습니다. summary의 test 건수는 command 건수와 별개이며 `--list`는 실제 CLI 선택만 기록하고 서버를 시작하지 않으며 실행 통과로 세지 않습니다. CLI 선택이 실행 중 달라지거나 파일 실행이 실패하면 전체 명령도 실패합니다.

기본 trace/자동 screenshot 설정은 꺼져 있습니다. G04 여정은 로그인 후 명시 trace·화면과 실패 DOM을 private 산출물로 남깁니다. 보고서는 환경 덤프/인증 헤더/DB 원문을 출력하지 않습니다. 증거는 합성 자료여도 비공개 보관하며 실패 로그를 삭제하거나 성공으로 재명명하지 않습니다. `RESTART_REPORT`, `IDENTITY_RESTART_REPORT`, `IDENTITY_RACES_REPORT`는 해당 검사기의 선택 출력입니다. 구현자 자기검증과 독립 검증/통합 회귀는 별개입니다.

```bash
EVIDENCE_ROOT=.local/g01-evidence python3 scripts/record-command.py check -- npm run check
```

기록기는 실제 cwd·argv·시작/종료·exit·stdout/stderr·SHA-256을 매 실행 새 파일로 남깁니다. 환경변수 덤프는 하지 않습니다. `scripts/verify-dev.ts`는 잘못된 선택 AI 설정에서도 실제 로그인 후 기본 업무가 열리는지를, `verify-unavailable.ts`는 DB 실패를, `verify-client-bundle.ts`와 `verify-server-boundary.ts`는 기존 서버 경계를 검사합니다.

## 환경·후속 확장

Next/CLI는 현재 프로젝트의 환경 로딩 규칙을 사용합니다. `.env.example`만 형식 참고에 사용하고 실제 `.env`는 추적 제외입니다. 저장 설정과 선택 AI 설정을 분리하여 AI 키/설정이 기본 업무를 막지 않습니다. 서버 환경 값은 브라우저 props/health/로그로 반환하지 않습니다. 지정 alias `gpt-6 astra`만 `gpt-6-astra`로 정규화하며 다른 모델 값은 보존합니다. 실제 허용 입력으로 OpenAI를 호출해 schema/근거/usage를 확인하는 검증은 G17의 필수 작업입니다.

G01에서는 설치된 Next **16.3.5**의 authentication·cookies·route-handlers 가이드를 읽고 DB 세션과 서버 DAL을 구성했습니다. 버전은 accepted package/lockfile 그대로이며 신규 의존성은 없습니다. G00 때 참조한 `/Users/evan/workspace/hackathon`의 앱/fixture/DB를 복사하거나 원본을 변경하지 않았습니다. 공개 패키지 license·scaffold 검토는 G00 증거에 남아 있습니다.

다음 모듈은 `src/server/auth/service.ts`의 principal과 `src/server/policy/`의 action/resource 정책을 소비하고 새 mutation마다 동일 UoW 내부 최신 상태 검사를 추가해야 합니다. G04는 실제 업무·파일·요청 버전 연결을 제공하며 G05는 실제 제출 작성자 연결, G18은 존재하는 전 채널 및 전체 영속성 회귀를 소유합니다. G02 당시의 harness 결과만으로 후행 경로를 검증했다고 계산하지 않습니다.

## G02 정책과 검증 경계

`policy.ts`는 세션/계정·현재 멤버십·관리/가격 grant를 같은 동기 transaction에서 다시 읽습니다. 클라이언트 역할이나 이전 요청의 capability를 권한으로 사용하지 않습니다. 알 수 없는 action/kind/공개 범위는 거부하며, 타 범위/없는 자료는 동일한 404 응답입니다. 내부 원문 접근과 가격 접근은 별개입니다. 회원 관리의 peer identity에는 다른 사용자의 adminGrant를 포함하지 않고, 본인의 세션 DTO에만 명시 grant를 제공합니다.

`projection.ts`는 현재 업무·상품·컨텍스트·회원·감사 DTO를 허용 필드로 구성합니다. 내부 공급가/공급률은 브랜드와 가격 권한 없는 GSG에게 필드 자체가 없습니다. 현재 합성 업무의 `notes`는 공개 안내입니다. 기존 `contributorIds`는 이력이며 공동담당 권한으로 해석하지 않습니다. G04는 실제 공개/초안 및 현재 주/공동담당 메타데이터를 생산합니다. 기존 G00/G01 adapter의 공개 합성 미리보기와 실제 내부 초안의 권한은 구분합니다.

현재 연결: 인증/컨텍스트 관리와 G04 업무·프로젝트·템플릿·참고파일 API, 홈·업무·상품 조회 HTML/RSC. 부트스트랩 로그인/초대 수락/CSRF와 데이터 없는 health는 인증 전 예외입니다. 일반 응답은 no-store이며 body는 읽는 중 16KiB에서 제한하고 입력 키를 검사합니다. 429는 Retry-After를 제공합니다.

G04 참고파일 original/preview/download와 원본·참조 범위는 실제 endpoint로 연결했습니다. 후행 계약만 있는 경로는 실제 제출 lead/co/team, 상품 가격·통합 검색/정렬/페이지/count·Excel/export, 알림 수신자, AI 입력/결과입니다. 정책은 원본과 모든 참조의 현재 권한을 확인하고 projection 이후 검색/집계를 수행합니다. `projectChannel`은 최소 harness 계약이며 후행 모듈은 실제 DTO allowlist와 HTTP/파일 검사를 추가해야 합니다. D02~D05의 후행 소비와 G18 회귀 의무는 남습니다. GSG 완료 정책은 잔여 질문/외부 대기/AI 실패를 승인 게이트로 삼지 않습니다.

```bash
npm run check
npm run build
E2E_PORT=4121 APP_ORIGIN=http://127.0.0.1:4121 npm run test:e2e
E2E_PORT=4121 APP_ORIGIN=http://127.0.0.1:4121 npm run test:e2e:db
E2E_PORT=4121 node --import tsx scripts/verify-policy-http.ts
E2E_PORT=4121 node --import tsx scripts/verify-policy-browser.ts
E2E_PORT=4121 E2E_AUX_PORT=4124 node --import tsx scripts/verify-policy-isolation.ts
```

권한 HTTP 검사기는 합성 전용 DB와 `E2E_PORT` 서버(기본 4121)를 직접 생성해 중첩 비공개 marker·실제 cookie/CSRF·HTML/RSC·권한 철회·재시작·DB 오류를 검사합니다. isolation 검사는 `E2E_PORT`(기본 4121)와 `E2E_AUX_PORT`(기본 4124)에 독립 DB/쿠키를 생성합니다. 다른 슬롯을 배정받았다면 위 명령의 두 환경변수 값만 바꾸세요. 검사기 소스를 수정할 필요가 없습니다. APP_ORIGIN, Client 요청, 쿠키 이름(`gs_hale_g02_<주 포트>` / `gs_hale_g02_aux_<보조 포트>`), 검사와 결과 보고가 지정한 두 포트를 따릅니다. 서로 다른 1~65535 정수만 허용하며 사용 중인 포트에서는 실행하지 마세요. 기본 제품 APP_ORIGIN은 3000으로 유지하며 검증 포트를 제품 기본값으로 바꾸지 않습니다. 아직 없는 후행 API는 harness 검사로만 기록하고, 구현된 G04 파일/API와 구분합니다.

HTTP 검사의 직접 `_rsc` 요청은 프로토콜 probe입니다. 별도 browser 검사는 비공개 합성 marker를 저장한 SQLite에서 PC/모바일의 실제 Link 이동·prefetch가 만든 RSC 응답과 화면을 확인합니다. 로그인 요청/인증 헤더는 수집하지 않고 응답의 안전한 본문·경로·hash·비공개 필드 부재를 기록합니다. 각 서버 검사는 같은 포트를 사용하므로 순서대로 실행하세요.

`EVIDENCE_ROOT`로 보고서 위치를 지정할 수 있으며 각 실행은 timestamp가 다른 보고서를 남깁니다. `scripts/verify-policy-command.py --requirements AC-02-01,A19 --level HTTP label -- <command>`는 실제 명령/cwd/exit/시각/요구 ID/로그 hash를 남깁니다. 기록기에는 `EVIDENCE_ROOT`가 필요합니다. command 수와 unit test/HTTP assertion/UI scenario 수를 합쳐 부풀리지 않으며 실패·재시도는 별도 이력으로 보존합니다.

## 데모/발표 도입

**글로벌 헬스케어의 새로운 물결**

GS HALE은 해외 헬스케어 진출에 필요한 모든 일을 하나의 흐름으로 연결해, 글로벌 헬스케어 시장에 새로운 물결을 만드는 플랫폼입니다

현재 시연은 로그인 → 컨텍스트 생성/전환 → 초대 수락 → 담당자 중지/재배정과 이력 → 업무/상품 탐색 순서입니다. 실제 메일 발송·현업 자료·AI 연동을 시연했다고 설명하지 않습니다.

## G04 업무 요청과 참고자료

업무 메뉴에서 신규 입점 프로젝트를 만들고 필요한 기본 유형을 선택하거나, 프로젝트에 연결되지 않은 스팟 업무를 작성합니다. GSG 책임자·브랜드 주담당·공동담당은 같은 컨텍스트의 활성 회원을 선택합니다. 프로젝트의 병렬 업무와 선행 관계, 추가 제품의 별도 요청, 회차·대상 기간 복제는 기존 업무 진행을 초기화하지 않습니다.

기본 7종 템플릿과 직접 작성에서 8종 요청 항목, 필수/선택·조건·제품 범위, 규격 출처/버전과 자동/사람 확인 구분을 저장합니다. 내부 초안은 브랜드에 보이지 않으며 서버의 공개 미리보기를 확인한 후 공개합니다. 날짜만 정해진 기한과 시각이 정해진 기한을 구분하고, 외부 신청/검토/인쇄·납품/게시·사용 일정·확인 상대는 브랜드 마감과 별도로 보존합니다. 원문의 요일·날짜 충돌은 원문으로 남깁니다. 외부 상대 계정이나 실제 발송 기능은 만들지 않습니다.

다중 컨텍스트 생성에서는 기한·외부 일정 확인 담당을 각 대상 GSG 책임자로, 제품별 요건을 각 대상의 선택 Product IDs로 복제합니다. 개별 초안을 검토한 뒤 따로 공개합니다. 공개 이후 수정은 새 요청 버전이며 템플릿 변경은 선택한 업무에만 적용합니다. 빈 확인 담당을 가진 기본 템플릿 적용은 해당 업무 GSG 책임자로 채웁니다. 일정 조정은 제안만으로 마감을 바꾸지 않습니다. GSG가 반영하면 현재 공개본의 기한만 새 버전으로 공개하며, 별도 미공개 초안은 보존합니다. 초안과 공개본이 달라진 경우 다음 공개 전에 초안 기한도 검토해야 합니다.

참고자료는 인증된 `POST /api/files?taskId=...`에서 업로드하며 `GET /api/files/:id?taskId=...&mode=download|original|preview`에서 원본과 참조 업무의 최신 권한을 모두 검사합니다. private 파일 저장소는 기본 `.data/files`, 선택 환경변수 `FILE_STORAGE_DIR`입니다. 웹 public 폴더가 아닙니다. 1개 25MiB·1회 10개 제한과 이름/확장자/MIME/기본 signature 검사를 적용하고, PDF/PNG/JPEG만 브라우저 미리보기를 제공합니다. 다른 허용 형식은 원본 다운로드로 확인합니다. 악성코드 백신/파일 내용의 전문가 검토를 수행했다고 주장하지 않습니다. 과거 공개 요청의 정확한 FileVersion은 새 버전 이후에도 현재 권한이 있는 사용자가 조회할 수 있습니다.

G04의 읽음·수락·일정 협의는 제출·검토·업무 완료와 별개입니다. 상품 스냅샷(G06)은 연결됐으며 이 후보의 실제 답변 서버(G05)는 UI 작업과 검증을 진행 중입니다. GSG 수동 완료(G11), 앱 알림 소비(G13)는 후행 기능입니다. 기존 G04 과거 답변 검사의 합성 prior-submission과 실제 G05 제출을 구별합니다. 요청 변경 이력과 durable outbox는 실제 저장되지만 알림 발송/수신 완료로 표시하지 않습니다. 참고자료 업로드만으로 결과물이 제출된 것으로 계산하지 않습니다. 실제 환경의 파일 백업·재해 복구는 별도 운영 검증입니다.

```bash
npm run check
npm run build
# 이미 비어 있는 검증 슬롯을 사용; 기본 제품 포트는 3000 유지
TASKS_MODE=sqlite E2E_PORT=4144 npm run tasks:http
TASKS_MODE=mock E2E_PORT=4144 npm run tasks:http
E2E_PORT=4141 APP_ORIGIN=http://127.0.0.1:4141 npm run test:e2e
E2E_PORT=4141 APP_ORIGIN=http://127.0.0.1:4141 npm run test:e2e:db
```

HTTP 검사기는 새 `.data/g04-http-*` DB/파일과 별도 쿠키 이름을 사용하며 자신의 서버만 종료합니다. SQLite 모드는 실제 서버 종료·재기동 후 재로그인하여 요청 버전·활동 순서·원본 byte hash를 비교합니다. mock은 메모리 모드이므로 프로세스 종료 후 업무 영속성을 주장하지 않습니다. `TASKS_HTTP_REPORT`와 브라우저 `E2E_REPORT`/`E2E_ARTIFACTS`는 선택 보고서 경로입니다. 실제 `.env`·외부 API·메일은 필요하지 않습니다.

## G06 상품 UI·API 계약

브랜드 공통 상품은 기존 Product ID를 유지하고, 컨텍스트별 SKU·JAN·등록/판매/출시 정보·프로젝트·파일 연결과 소비자가/내부 공급가를 별도 버전으로 저장합니다. `npm run db:setup`은 migration 0004와 모든 기존 상품의 원본 보존 이행을 실행합니다. 이미 이행한 상품은 다시 덮어쓰지 않으며 모호한 기존 용량 문자열은 원문으로 남깁니다.

인증된 `/api/products`의 목록·생성, `/api/products/:id?context=...`의 상세·명령, `/api/products/:id/impact`의 공통 변경 미리보기를 제공합니다. 상품 파일은 `POST /api/files?productId=...&contextId=...`와 같은 소유 범위를 사용하는 GET으로 처리하며 기존 `taskId` 파일 경로도 유지합니다. 업로드 한도와 private 저장소는 G04와 같습니다. 브랜드의 같은 컨텍스트 비담당자도 공개 상품을 편집할 수 있고, 내부 가격 필드·이력은 최신 명시 권한이 있는 GSG에게만 전달합니다.

공통 정보 변경은 공유된 현재 정보를 갱신합니다. 미리보기에는 읽을 수 있는 적용 컨텍스트만 표시하고 숨겨진 대상의 이름·수·가격·파일은 반환하지 않습니다. 저장 명령은 각 common/context/price의 revision과 idempotencyKey를 사용합니다. `captureProductUse`는 후속 제출 트랜잭션에서 쓸 정확한 common/context/file 버전과 명시적으로 선택한 소비자가 버전을 저장합니다. 최신 가격을 당일 적용 가격으로 자동 간주하지 않습니다.

G06의 상품 UI/API는 통합·브라우저 검사·독립 검증과 메인 수용을 마친 단계입니다. 초기 prior-use 레코드는 계약 검증용이며 실제 제출이 아닙니다. 이 G05 서버 후보는 실제 제출 트랜잭션에서 상품 사용본을 만들지만 G05 전체 수용을 뜻하지 않습니다. G07 증빙 집계/Excel, G10 검토, G11 완료 연결은 후속 의무입니다. 자료 집계는 연결 전 `connected:false`와 `null`로 표시합니다.

상품 서버 검사기는 새 전용 DB/파일·쿠키와 자신의 프로세스를 사용합니다. SQLite 모드는 두 포트에서 실제 동시 수정/중복 등록을 확인하고 종료·재시작·재로그인 후 정확한 상품/가격/파일/스냅샷을 비교합니다. mock 모드의 fixture 준비는 검사 전용 IPC이며 제품 API에 준비용 경로를 추가하지 않습니다. 과거 사용 스냅샷은 명시적 fixture이며 실제 G05 제출 완료로 계산하지 않습니다.

```bash
npm run build
PRODUCTS_MODE=mock E2E_PORT=4161 E2E_AUX_PORT=4164 npm run products:http
PRODUCTS_MODE=sqlite E2E_PORT=4161 E2E_AUX_PORT=4164 npm run products:http
npm run products:migration-check
```

`PRODUCTS_HTTP_REPORT`는 보고서 경로를 지정하며 실제 요청/상태/응답 hash와 프로세스 종료를 남깁니다. `E2E_PORT`/`E2E_AUX_PORT`는 비어 있는 자신 소유 슬롯으로 함께 바꿀 수 있습니다. 기존 원장에 이행할 수 없는 상품이 있으면 전체 데이터 이행을 원복하고 CLI에 G06 모듈·상품 ID·원본 컨텍스트 ID·허용된 사유만 표시합니다. 원문 값·비공개 가격·stack을 진단에 넣지 않으며 API의 일반 오류 응답도 그대로 유지합니다.

## G05 답변 서버 계약

`src/server/submissions/contracts.ts`가 입력/출력 타입 진입점입니다. 현재 공개 요청에 대해 브랜드 주·공동 담당자 또는 허용 GSG가 공유 초안을 저장합니다. 팀 비담당자는 공개 제출만 읽으며 미제출 초안/임시파일은 받지 않습니다. GSG 대리는 실제 자료 제공자와 로그인 기록자를 구분합니다.

- `GET /api/tasks/:id/submissions`: 신선한 권한으로 초안, 실제 제출/이력, 후보 파일/상품을 조회합니다. `draftEvaluation`은 편집 초안, `submittedEvaluation`은 실제 최신 제출을 현재 요청에 대조한 진행입니다.
- `POST /api/tasks/:id/submission-evaluation`: `{baseRequestId,content}`를 쓰기 없이 검사합니다. 8종 입력·조건 계층·필수 누락을 계산합니다. 자유문자 규격의 `check:auto`도 실행 가능한 규칙이 아니므로 사람 확인 대기이며 자동 검증 완료가 아닙니다.
- `POST /api/tasks/:id/submission-draft`: `save`, `rebase_apply`, `copy_submission` 명령. 요청 ID와 공유 초안 revision을 검사합니다. 숫자 `-` 등 입력 중 값은 보존하고 제출 시 유효성을 검사합니다. `GET`은 요청 변경 후 명시적 이어받기 미리보기입니다.
- `POST /api/tasks/:id/submissions`: 저장한 초안의 부분/전체 제출. 같은 초안 revision은 한 번만 소비합니다. 요청·상품·파일의 정확한 버전, 감사, 이벤트, 멱등 응답, 업무 진행을 한 transaction으로 기록합니다. 전체 제출은 구조적 충족이며 검토 승인/실물 수령/업무 완료가 아닙니다.
- `GET /api/submissions/:id`: 불변 과거 제출과 당시 상품 사용본. 현재 권한과 원본/참조 권한은 다시 확인합니다.
- `POST /api/tasks/:id/submission-files?requestId=...`: multipart `files`와 같은 순서의 `clientItemIds` 각 1~10개. `{items:[{clientItemId,state:'ready',file}|{clientItemId,state:'failed',error}]}`로 성공을 유지하고 실패 파일만 재시도합니다. 파일당 25MiB와 기존 MIME·시그니처 검사를 적용하며 전역 `/api/files` 응답은 변경하지 않습니다.

모든 변경 요청은 기존 Origin/CSRF/세션 정책을 사용합니다. `REQUEST_CHANGED`, `DRAFT_CHANGED`, `CONFLICT` 409에서 입력과 준비된 파일 ID를 유지하고 최신 조회/명시적 비교·재선택을 사용합니다. 업로드/초안 저장은 제출 상태를 바꾸지 않습니다. 임시 참조 제외는 물리 삭제가 아니며, 공개 요청 또는 실제 불변 제출에 포함되어야 다른 업무/상품이 재사용할 수 있습니다. 외부 링크는 서버가 수집하지 않고 내용 미고정으로 보존합니다. 보류/취소 중 초안 저장은 가능하고 새 제출은 재개 후 가능합니다.

합성 단위 검사는 `npx vitest run tests/unit/submissions.test.ts`이며 mock/SQLite 양쪽에서 실제 생성·부분/전체·v2·CAS·멱등·권한·업로드·요청변경·상품 캡처·rollback을 검사합니다. `0005-submissions.sql`은 업무당 공유 초안, 순번/초안 소비/파일 재시도 키의 고유성과 제출 불변성을 추가합니다. 실패저장 복구는 승인된 사용자/컨텍스트/업무/요청별 bounded sessionStorage 계약을 후속 UI가 구현하며 원시 File bytes/쿠키는 저장하지 않습니다.

G05 실제 HTTP 검사는 production build 후 아래처럼 자신이 소유한 비어 있는 두 포트를 사용합니다. 검사기는 실제 API로 합성 답변을 만들고 mock/SQLite를 각각 확인합니다. SQLite에서는 두 서버의 CAS/중복 제출과 실제 종료·새 PID 재기동·재로그인을 검사합니다. 환경/쿠키/기밀 API는 필요하지 않습니다.

```bash
SUBMISSIONS_MODE=mock E2E_PORT=4151 E2E_AUX_PORT=4154 npm run submissions:http
SUBMISSIONS_MODE=sqlite E2E_PORT=4151 E2E_AUX_PORT=4154 npm run submissions:http
```

`SUBMISSIONS_HTTP_ROOT`는 새 고유 DB/파일 런타임 디렉터리의 부모(기본 `.local/g05-http`), `SUBMISSIONS_HTTP_REPORT`는 요청 상태·응답 hash·assertion 결과·프로세스 종료 보고서 경로입니다. 과거 보고서를 덮어쓰지 않게 새 경로를 사용하세요. SQLite 검사의 private fixture는 실제 생성된 레코드의 읽기·해시 대조만 하며, mock은 같은 읽기 전용 관찰을 IPC로 수행합니다. 실제 UI·브라우저·복구 및 독립 검증은 별도 실행 증거로 구분합니다.

저장된 공개 요청의 항목 구조가 손상된 경우 `REQUEST_INVALID`409로 답변 쓰기를 거부합니다. 읽기 평가는 `needs_reconfirmation`, `canSubmitFull:false`, 요청 구조 확인 필요를 표시합니다. 비정상 상품 범위를 공통 항목으로 바꿔 제출을 허용하지 않습니다. GSG가 실제 요청 편집에서 규칙을 확인·정정한 뒤 다시 공개하고, 작성자는 유지한 답변을 명시적으로 비교·재적용합니다. 정상 값의 알 수 없는 추가 키는 공개 출력에서 제외하지만 합법적인 제출은 유지합니다. 이 답변 구조 검사는 후행 GSG 수동 완료의 강제 승인 게이트가 아닙니다.

## G07 증빙·표준 Excel 서버 계약 후보

G07 서버 계약 구현 단계입니다. 자료·Excel UI의 통합 및 독립 수용은 아직 진행 전입니다. 현업 원본 Excel 검증은 원본 미확보로 `NOT_RUN`이며, 합성 표준 `.xlsx`의 실제 검증과 구분합니다.

증빙은 공개 요청/실제 제출/상품 자료의 정확한 파일 버전을 참조합니다. 파일을 복제하지 않고 상품별 적용 상태와 이력을 분리합니다. 적용 확인은 인증 승인·유효성 판단이 아닙니다. 업로드/증빙 등록만으로 제출하지 않으며, 증빙의 해당 없음은 공개 요청의 필수 항목을 면제하지 않습니다. 상품 자료 수는 현재 공개 요청과 실제 제출을 같은 표 projector로 집계합니다.

Excel은 `GET /api/imports?context=ID`의 허용 열/한도를 받아 표준 양식을 사용합니다. `GET /api/imports/workbook?context=ID&kind=template|export`로 새 workbook을 생성합니다. `POST /api/imports/source?context=ID`에 multipart `file` 하나 → `POST /api/imports/preview`의 시트/헤더/열/행 선택 → `POST /api/imports/apply`의 명시적 반영 순서입니다. 한 배치는 선택한 컨텍스트 하나이며 모든 행의 `contextKey`가 일치해야 합니다. 숫자로 저장한 제품 코드·SKU·JAN·ITF의 손실된 0은 복구하지 않습니다. 업데이트의 빈 셀은 기존 값을 유지하고 `clearFields`로만 명시적으로 비웁니다.

미리보기는 업무 DB를 변경하지 않고 권한을 확인한 비공개 임시 분석본만 저장합니다. `IMPORT_STORAGE_DIR`(기본 `.data/imports`)는 사용자별 최대 50개, 24시간 정리 대상이며 미리보기 적용 유효 시간은 30분입니다. 성공 배치·출처·버전·재시도 영수증은 DB에 영속됩니다. 동기 단일 트랜잭션에서 전체 CAS와 오류를 확인한 뒤 전부 반영합니다. 인증/가격 권한은 재시도 때도 현재 상태로 확인합니다.

분석은 `exceljs@4.4.0`, `yauzl@3.4.0`와 설치된 `tsx`를 별도 Node 프로세스에서 사용합니다. ExcelJS 하위 `uuid`만 `11.1.1`로 고정해 버퍼 경계 advisory의 수정 버전을 사용하며, CJS/조건부 서식 workbook 호환성을 검사합니다. 10MiB 원본, ZIP 512개 항목/항목 32MiB/총 64MiB, 20시트/300,000 실제 셀, 선택 자료 5,000행·100열, 셀 32,767문자, 10초 제한과 256MiB V8 old-space 한도를 적용합니다. V8 한도는 프로세스 총 RSS 한도가 아닙니다. 암호화·매크로·수식 계산·외부 workbook/OLE 연결은 지원하지 않으며 링크를 실행하거나 가져오지 않습니다. `.xls` 보관은 기존 첨부 기능으로 가능하지만 Excel 가져오기는 `.xlsx`만 지원합니다.

계약 검사는 작업 worktree 루트에서 다음과 같이 실행합니다. 실제 실행 결과와 실패 원본은 별도의 비공개 실행 증거에 남깁니다.

```sh
npm ci
npm run check
npm run build
npx vitest run tests/unit/evidence.test.ts tests/unit/imports.test.ts tests/unit/products.test.ts tests/unit/repositories.test.ts
```
