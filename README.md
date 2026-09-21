# GS HALE

**Healthcare & Aesthetic Launch Enablement**

**해외 헬스케어 진출의 모든 일**

GSG 한국법인의 컨텍스트별 리테일 업무를 연결하는 플랫폼입니다. 현재 후보는 **G00 실행·저장 기반**입니다. 합성 데이터의 홈 → 업무 목록/상세 → 상품 목록/상세 탐색과 mock/SQLite 저장 계약을 제공합니다.

로그인·멤버십·서버 권한·업무 생성/제출·상품 편집·파일·Excel·문의·AI 등 G01~G18의 후행 기능은 아직 구현하지 않았습니다. 컨텍스트 선택은 합성 자료 탐색 기능이며 접근 제어 검증을 대신하지 않습니다. 외부 서비스 호출과 실데이터는 없습니다.

## 설치와 실행

Node **24.x**, npm **11.x**를 사용합니다. lockfile을 포함합니다. 아래 명령은 실행할 체크아웃/worktree의 루트에서 실행하세요. 다른 프로젝트의 node_modules·DB·환경파일을 연결하지 않습니다.

```bash
npm ci
npm run dev:mock -- --port 4101
```

`http://127.0.0.1:4101`에서 홈·업무·상품정보를 확인합니다. 기본 `npm run dev`도 `DATA_SOURCE` 미설정 시 mock입니다. API 키와 `.env`는 필요 없습니다. `npm run build` 후 `npm start -- --port 4101`로 production 빌드를 확인할 수 있습니다. 개발 서버/검증 서버는 loopback에만 바인딩합니다.

mock은 프로세스 메모리를 사용하며 재시작 시 합성 fixture로 초기화됩니다. 현재 UI는 읽기 전용입니다. 저장/갱신은 테스트에서 공통 adapter 계약으로 검증합니다.

## SQLite

```bash
DATABASE_FILE=.local/data/gs-hale.db npm run db:migrate
DATABASE_FILE=.local/data/gs-hale.db npm run db:seed
DATABASE_FILE=.local/data/gs-hale.db npm run dev:db -- --port 4101
```

`npm run db:setup`은 migration과 seed를 순서대로 실행합니다. 경로를 생략하면 `.local/data/gs-hale.db`를 사용합니다. `db:migrate`는 빈 DB를 생성하고 적용된 파일의 SHA-256을 기록하며 재실행해도 동일 migration을 중복 적용하지 않습니다. 적용된 SQL 파일을 바꾸면 실패하므로 이후 변경은 새 migration으로 추가합니다.

`db:seed`는 **누락된 fixture ID만 추가**합니다. 기존 수정값·추가 레코드를 덮어쓰거나 삭제하지 않습니다. 기존 DB를 초기화하는 명령은 제공하지 않습니다. 앱 실행은 migration/seed를 자동으로 수행하지 않습니다. DB 파일 또는 테이블이 없으면 명시적 오류와 `/api/health`의 503이 반환되며 mock으로 전환하지 않습니다.

`npm run db:restart`는 별도 자식 프로세스에서 합성 레코드를 쓰고 프로세스를 종료한 뒤 새 프로세스로 동일 ID/값을 읽습니다. 보고서는 `.local/restart-*/restart.json` 또는 `RESTART_REPORT`에 저장합니다. 이것은 G00 adapter 영속성 검증이며 로그인/전체 업무의 영속성 완료를 뜻하지 않습니다.

## 검증

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run db:restart
npm run test:install
npm run test:e2e
npm run test:e2e:db
```

`npm run verify`는 위의 기본 검사(build 이후 브라우저 포함)를 순서대로 실행합니다. 브라우저 설치는 사전에 한 번 수행해야 합니다. Playwright는 기본 4101 포트에 자체 production 서버를 실행하며 기존 서버 재사용을 금지합니다. 충돌하면 해당 서버를 종료하지 말고 예약한 다른 포트를 `E2E_PORT`로 지정하세요. SQLite 검증은 실행별 `.local/e2e-*` DB를 새로 생성합니다. desktop/mobile의 동일 합성 탐색·빈 상태·404·키보드 흐름을 확인하며 trace와 screenshot을 남깁니다.

선택 출력 경로: `E2E_REPORT`(JSON), `E2E_ARTIFACTS`(trace/screenshot), `RESTART_REPORT`(DB 프로세스 증거). 보고서는 worktree 내부 또는 지정된 증거 경로에만 기록합니다. 실패/미실행을 통과로 보고하지 않습니다. 구현자 자체 테스트와 독립 검증/통합 회귀는 별개입니다.

명령 증거 기록 예:

```bash
EVIDENCE_ROOT=.local/g00-evidence python3 scripts/record-command.py unit -- npm test
```

이 스크립트는 실제 cwd·argv·시작/종료·exit code·stdout/stderr·SHA-256을 매 실행별 새 파일로 보존합니다. 환경변수 덤프는 하지 않습니다. 로그에 비밀값을 출력하는 명령을 전달하지 마세요.

## 저장소 계약과 후속 확장

- `src/domain/records.ts`: typed `RecordDataMap`, `StoredRecord`, 공통 `RecordRepository`, 동기 `UnitOfWork`, 오류 코드. 메타데이터는 ID·contextId·revision·UTC 시각입니다.
- `src/server/repositories/{mock,sqlite}.ts`: Promise 조회와 `transaction(callback)`을 제공하며 callback 내부 CRUD는 동기입니다. 실패 시 전체 rollback, 중복 ID·stale revision은 `CONFLICT`입니다. 반환 객체의 외부 변경은 저장값을 바꾸지 않습니다.
- transaction 밖에서 네트워크/비밀번호 해시 등 비동기 작업을 수행하고, 안에서는 최신 권한·상태·revision을 재검사하세요. async callback을 넘기면 rollback 후 `ASYNC_TRANSACTION`으로 거부하고 callback 밖으로 빠져나간 UoW 접근도 차단합니다.
- SQLite `records`는 `(kind,id)` 고유, kind/context 인덱스와 JSON 검사를 제공합니다. 이 최소 문서 저장 테이블은 **G01의 사용자/멤버십 고유 조합·FK·인증 정책을 구현한 것이 아닙니다.** 해당 도메인의 관계/고유 조건과 migration은 후행 모듈에서 확장합니다.
- G00 clock을 주입할 수 있고 ID는 호출자가 제공하며 `IdFactory` 확장 경계가 있습니다. 런타임 DB는 실제 앱에서 명시적으로 연결하며 mock은 SQLite 파일을 만들지 않습니다.
- `src/data/fixtures.ts`: 합성 국가/리테일러/브랜드 네 조합, 복수 사용자, 두 업무 분류, 부분 제출/기한 미정/자료 충돌 예시. `example.test` 연락처만 사용합니다. 빈 상태는 싱가포르 컨텍스트, 저장 실패는 fault tests로 재현합니다. 실제 제출/충돌 해결 기능이 있다는 뜻은 아닙니다.

## 환경·비밀값

Next가 현재 프로젝트의 `.env*`를 서버 프로세스에 로드합니다. CLI는 `@next/env`로 동일 로딩 순서를 사용합니다. 형식 참고는 `.env.example`이며 실제 `.env`는 추적에서 제외합니다. G00 검증에는 실키가 필요 없으므로 주입하지 않습니다.

서버 환경 접근은 `src/server/config/env.ts`의 `server-only` 경계를 통과합니다. 기본 업무의 `readStorageConfig`와 선택 AI의 `readAiConfig` 검증은 분리되어, 잘못된 AI 설정이 홈·DB 실행을 차단하지 않습니다. `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`은 브라우저 props/health/로그에 반환하지 않습니다. 모델 설정이 정확히 `gpt-6 astra`이면 동일 모델 API ID `gpt-6-astra`로만 정규화합니다. 다른 설정은 보존합니다. base URL은 기본 OpenAI HTTPS endpoint만 허용하며 다른 업체로 우회하지 않습니다. G00에는 API 클라이언트와 실제 호출이 없습니다. 실제 허용 입력의 연동 검증은 G17 필수입니다.

## 기존 scaffold 검토와 의존성

참조한 기존 프로젝트는 `/Users/evan/workspace/hackathon`입니다. `AGENTS.md`, package/config, 환경 로더, repository/DB 연결 구조와 설치된 Next **16.3.5** 문서를 읽었습니다. 앱·fixture·DB를 통째 복사하지 않았고 원본을 변경하지 않았습니다. GS HALE 코드와 migration은 새로 작성했으며 의존성 버전/Next 서버 경계 패턴을 참고했습니다. 과거 scaffold의 테스트 성공은 이 후보의 증거가 아닙니다.

버전은 package/lockfile에 고정했습니다. Next·React·better-sqlite3·Tailwind·ESLint·Vitest·tsx는 MIT, TypeScript·Playwright는 Apache-2.0이며 설치된 package metadata로 확인했습니다. 기존 scaffold 자체의 별도 LICENSE는 발견하지 못했으므로 앱 코드/자산 재배포 허가를 가정해 복사하지 않았습니다. SQL migration을 직접 관리하므로 G00에는 Drizzle ORM을 추가하지 않았습니다. 추후 ORM 채택 여부와 무관하게 repository 계약을 유지합니다.

코딩 전 읽은 버전 일치 가이드: `node_modules/next/dist/docs/01-app/01-getting-started/{01-installation,03-layouts-and-pages,05-server-and-client-components,15-route-handlers}.md`, `02-guides/environment-variables.md`, `03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`. 해당 문서는 Next 설치 후 같은 경로에서 확인할 수 있습니다.

## 데모/발표 도입 원고

**글로벌 헬스케어의 새로운 물결**

GS HALE은 해외 헬스케어 진출에 필요한 모든 일을 하나의 흐름으로 연결해, 글로벌 헬스케어 시장에 새로운 물결을 만드는 플랫폼입니다

현재 G00 시연에서는 합성 컨텍스트 선택 → 신규 입점/스팟 업무 → 상품정보 연결 → 빈 컨텍스트를 보여줍니다. 사용자 인증·실제 업무 작성·AI 연동과 최종 제품 완성은 별도 체크포인트로 검증합니다.
