# GS HALE

**Healthcare & Aesthetic Launch Enablement** · **해외 헬스케어 진출의 모든 일**

현재 후보는 G00 실행·저장 기반과 **G01 컨텍스트·사용자 관리**입니다. 합성 자료로 실제 서버 로그인, 컨텍스트 생성·전환, 초대 수락·재발급, 계정/멤버십 중지, 브랜드 담당자/GSG 책임자 재배정과 변경 이력을 제공합니다. 홈 → 업무 → 상품의 기존 조회도 서버 인증과 컨텍스트 범위를 확인합니다.

G02의 전 채널 정책 행렬과 G03~G18의 전체 업무 작성·제출·상품 CRUD·파일·Excel·문의·AI는 아직 구현하지 않았습니다. 현재 과거 작성자 참조는 합성 Task 레코드이며, 실제 제출/버전 경로와 연결한 회귀 검사는 G04/G05/G18에서 수행해야 합니다. 외부기관 계정, 실제 이메일 발송, 실제 API 호출은 없습니다.

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

Playwright는 기본 4111 포트에서 자체 production 서버를 실행하며 기존 서버를 재사용하지 않습니다. 충돌 시 다른 서버를 종료하지 말고 예약한 `E2E_PORT`를 지정하세요. 매 실행 전용 DB를 `.local`에 생성하고 desktop/mobile에서 실제 로그인·컨텍스트 생성·초대/재발급/수락·중지·재배정·빈 상태·오류 입력 유지·격리·기존 G00 탐색과 키보드를 검사합니다. 쿠키/토큰/비밀번호가 포함되는 일반 network trace와 자동 실패 스크린샷은 끄고, 민감 입력이 없는 화면만 명시적으로 촬영합니다.

선택 출력: `E2E_REPORT`, `E2E_ARTIFACTS`, `RESTART_REPORT`, `IDENTITY_RESTART_REPORT`, `IDENTITY_RACES_REPORT`. 보고서에 토큰/쿠키/비밀번호·DB 원문을 출력하지 않습니다. 실패 로그는 삭제하거나 성공으로 재명명하지 않습니다. 구현자 자기검증과 독립 검증/통합 회귀는 별개입니다.

```bash
EVIDENCE_ROOT=.local/g01-evidence python3 scripts/record-command.py check -- npm run check
```

기록기는 실제 cwd·argv·시작/종료·exit·stdout/stderr·SHA-256을 매 실행 새 파일로 남깁니다. 환경변수 덤프는 하지 않습니다. `scripts/verify-dev.ts`는 잘못된 선택 AI 설정에서도 실제 로그인 후 기본 업무가 열리는지를, `verify-unavailable.ts`는 DB 실패를, `verify-client-bundle.ts`와 `verify-server-boundary.ts`는 기존 서버 경계를 검사합니다.

## 환경·후속 확장

Next/CLI는 현재 프로젝트의 환경 로딩 규칙을 사용합니다. `.env.example`만 형식 참고에 사용하고 실제 `.env`는 추적 제외입니다. 저장 설정과 선택 AI 설정을 분리하여 AI 키/설정이 기본 업무를 막지 않습니다. 서버 환경 값은 브라우저 props/health/로그로 반환하지 않습니다. 지정 alias `gpt-6 astra`만 `gpt-6-astra`로 정규화하며 다른 모델 값은 보존합니다. 실제 허용 입력으로 OpenAI를 호출해 schema/근거/usage를 확인하는 검증은 G17의 필수 작업입니다.

G01에서는 설치된 Next **16.3.5**의 authentication·cookies·route-handlers 가이드를 읽고 DB 세션과 서버 DAL을 구성했습니다. 버전은 accepted package/lockfile 그대로이며 신규 의존성은 없습니다. G00 때 참조한 `/Users/evan/workspace/hackathon`의 앱/fixture/DB를 복사하거나 원본을 변경하지 않았습니다. 공개 패키지 license·scaffold 검토는 G00 증거에 남아 있습니다.

다음 모듈은 `src/server/auth/service.ts`의 principal/hasScope를 재사용하고 새 mutation마다 동일 UoW 내부 최신 상태 검사를 추가해야 합니다. G02는 generic read/write/internal-price 정책 harness, G04/G05는 실제 업무·제출 작성자 연결, G18은 존재하는 전 채널 및 전체 영속성 회귀를 소유합니다. 이번 구현이 그 후행 경로를 검증했다는 뜻은 아닙니다.

## 데모/발표 도입

**글로벌 헬스케어의 새로운 물결**

GS HALE은 해외 헬스케어 진출에 필요한 모든 일을 하나의 흐름으로 연결해, 글로벌 헬스케어 시장에 새로운 물결을 만드는 플랫폼입니다

현재 시연은 로그인 → 컨텍스트 생성/전환 → 초대 수락 → 담당자 중지/재배정과 이력 → 업무/상품 탐색 순서입니다. 실제 메일 발송·현업 자료·AI 연동을 시연했다고 설명하지 않습니다.
