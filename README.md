# GS HALE

**Healthcare & Aesthetic Launch Enablement**  
**해외 헬스케어 진출의 모든 일**

GS HALE은 국가×리테일러×브랜드 컨텍스트별로 GSG 한국법인과 브랜드가 신규 입점·스팟 업무, 상품정보, 요청 자료, 제출·보완·외부 진행을 함께 관리하는 플랫폼입니다.

**글로벌 헬스케어의 새로운 물결**

> GS HALE은 해외 헬스케어 진출에 필요한 모든 일을 하나의 흐름으로 연결해, 글로벌 헬스케어 시장에 새로운 물결을 만드는 플랫폼입니다

## 현재 검증 상태

현재 작업 브랜치는 Supabase 전환 통합 중입니다. PostgreSQL·인증·공유 업로드 기반과 로컬 worker 패키징은 독립 검증 및 통합 회귀를 거쳤습니다. **화면별 Storage 연결, 전체 Supabase 업무 여정, 최종 Vercel 파일/Excel/OCR·OpenAI 재검증과 최종 감사는 진행 중입니다. 전체 Goal 완료 상태가 아닙니다.**

최신 후보·수용 범위·남은 작업은 [실행 상태](.execution/run-plan.json), [재개 지점](.execution/checkpoint.md), [Supabase 완료 조건](.execution/supabase-acceptance.json)에서 확인합니다. 과거 mock/SQLite 검증을 현재 Supabase 전체 성공으로 간주하지 않습니다. 이 README는 현재 실행 안내이며, 단계별 과거 설명은 [보존본](docs/history/README-before-supabase-consolidation-20260922.md)에 남겼습니다.

## 실행

Node **24.x**, npm **11.x**를 사용하고 프로젝트 또는 배정받은 worktree의 루트에서 실행합니다.

```sh
npm ci
npm run dev:mock
```

기본 주소는 `http://127.0.0.1:3000/login`입니다. `.env`가 다른 주소를 사용 중이라면 로컬 실행 명령에 정확한 `APP_ORIGIN`을 지정합니다.

```sh
APP_ORIGIN=http://127.0.0.1:3000 SESSION_COOKIE_NAME=gs_hale_local npm run dev:mock
```

합성 관리자: `admin@example.test` / `Demo-Hale-2026!`. 같은 공개 합성 비밀번호의 `luna@example.test`는 복수 컨텍스트 브랜드 사용자, `operator@example.test`는 GSG 운영자, `selected@example.test`는 선택 컨텍스트 관리자입니다. 실제 서비스 계정으로 사용하지 않습니다. 기본 seed의 예시 업무와 실제 요청·제출 여정으로 생성한 업무는 구분합니다.

| 저장 모드 | 설정 | 보존 범위 |
| --- | --- | --- |
| mock | `DATA_SOURCE=mock` 또는 `npm run dev:mock` | 메모리 기록은 서버 재시작 시 초기화 |
| SQLite | `DATA_SOURCE=sqlite` 또는 `npm run dev:db` | 지정 DB 및 로컬 파일 경로에 보존; Vercel 공유 저장소 용도 아님 |
| Supabase | `DATA_SOURCE=supabase` 또는 `npm run dev:supabase` | PostgreSQL에 공유 기록; private Storage 소비 화면은 현재 전환·검증 중 |

저장 설정 오류가 발생하면 안전한 오류를 반환합니다. Supabase 오류를 mock이나 로컬 파일로 조용히 대체하지 않습니다. API 키가 없어도 mock/SQLite 기본 업무를 실행할 수 있습니다.

### SQLite

```sh
DATA_SOURCE=sqlite DATABASE_FILE=.local/data/gs-hale.db npm run db:setup
DATABASE_FILE=.local/data/gs-hale.db APP_ORIGIN=http://127.0.0.1:3000 npm run dev:db
```

`db:setup`은 migration과 seed를 실행합니다. `db:migrate`와 `db:seed`로 나눠 실행할 수도 있습니다. 서버 시작 시 자동으로 DB를 초기화하거나 seed를 덮어쓰지 않습니다. 적용된 migration checksum 변경을 거부하며 seed는 기존 사용자 변경을 보존합니다. 로컬 첨부와 Excel 임시 분석 경로는 `FILE_STORAGE_DIR`, `IMPORT_STORAGE_DIR`로 분리할 수 있습니다.

### Supabase

실제 값은 비추적 `.env`에 보관합니다. [.env.supabase.example](.env.supabase.example)은 변수 이름 참고용이며 기존 `.env` 위에 복사하지 않습니다.

| 변수 | 용도 |
| --- | --- |
| `DATA_SOURCE` | `supabase` 명시 |
| `DATABASE_URL` | 해당 프로젝트 Transaction pooler URI, 런타임 6543 |
| `DIRECT_URL` | 같은 프로젝트 Session pooler 또는 direct URI, migration 5432 |
| `SUPABASE_DB_SCHEMA` | 앱 전용 schema, 기본 `gs_hale`; 테스트는 고유 `gs_hale_*` 사용 |
| `SUPABASE_URL` | private Storage API 프로젝트 URL |
| `SUPABASE_SECRET_KEY` | 서버 전용 Storage secret; 브라우저에 전달하지 않음 |
| `SUPABASE_STORAGE_BUCKET` | private 버킷, 기본 이름 `gs-hale-private` |
| `APP_ORIGIN` | 해당 브라우저의 정확한 scheme·host·port |
| `SESSION_COOKIE_NAME` | 환경별 세션 쿠키 이름 |

`DIRECT_URL`은 migration 실행 환경에 필요하며 SQL 런타임 로그인에는 필요하지 않습니다. PostgreSQL은 Storage API URL 없이도 설정할 수 있습니다. 인증서와 hostname을 검증하며 TLS 검증을 비활성화하지 않습니다.

```sh
# 기존 .env의 비밀값은 명령행에 복사하지 않습니다.
DATA_SOURCE=supabase npm run db:supabase:migrate
DATA_SOURCE=supabase npm run db:supabase:seed
APP_ORIGIN=http://127.0.0.1:3000 SESSION_COOKIE_NAME=gs_hale_local npm run dev:supabase
```

이 명령은 지정한 원격 앱 schema에 migration·합성 seed를 추가합니다. 원본 데이터 삭제나 schema reset 명령은 제공하지 않습니다. 테스트에는 별도 `SUPABASE_DB_SCHEMA`를 지정하세요. foundation 전용 `db:postgres:seed`보다 위 앱 seed 명령을 사용해야 인증·템플릿·상품 이행 등 전체 앱 준비 경로를 거칩니다.

버킷은 private이고 25MiB 한도여야 합니다. 버킷 준비는 명시적 작업이며 일반 조회에서 생성하거나 기존 버킷 정책을 변경하지 않습니다. [Storage 기반 계약](docs/storage/storage-supabase-foundation.md), [공유 업로드 계약](docs/storage/storage-app-core.md), [PostgreSQL 계약](docs/storage/postgres-foundation.md)에 세부 조건과 검증 범위가 있습니다. 각 문서의 과거 후보 실행 건수는 해당 시점의 증거입니다.

### 빌드·배포 실행

```sh
npm run build
APP_ORIGIN=http://127.0.0.1:3000 npm start
```

빌드는 설치된 Next.js의 Webpack 경로를 사용합니다. Excel 자식 프로세스와 PDF/OCR의 native·일본어 모델 자산을 포함하고, `.env`·`.execution`·`.worktrees` 등 비공개 경로가 함수 번들에 들어가지 않도록 검사합니다. [worker 패키징 계약](docs/storage/worker-bundle.md)을 참고하세요.

Vercel은 현재 `vercel.json`의 `DATA_SOURCE=supabase`, `bom1` 설정을 사용합니다. Production의 `APP_ORIGIN`은 `https://g-30-pi.vercel.app`이며 Preview는 해당 환경의 정확한 주소를 사용해야 합니다. 비밀값에 `NEXT_PUBLIC_`를 붙이지 않습니다. 환경변수 변경은 새 배포에 반영되며, 로그인 HTTP 200만으로 보호 화면의 세션 유지·DB 영속성을 검증했다고 판단하지 않습니다.

## 업무 기능과 상태 구분

- **컨텍스트·사용자:** 국가×리테일러×브랜드별 멤버십, 초대·수락·재발급, 계정/멤버십 중지, 담당 재배정과 과거 작성자 보존. 외부 기관 계정은 만들지 않습니다.
- **신규 입점·스팟 업무:** 요청 설명·참고자료·필수/선택 응답·마감, 프로젝트·선행 관계, 주/공동 담당, 공개 요청 버전과 변경 이력.
- **상품정보:** 독립 목록·상세·편집, 브랜드 공통 정보와 컨텍스트별 SKU/JAN·가격·자료/인증, 실제 제출 당시 사용한 버전. 내부 공급가는 현재 명시 권한이 있는 GSG만 조회합니다.
- **답변·제출:** 줄글·값·파일 초안, 부분/전체 제출, 버전별 재제출과 상품 사용본. 업로드 성공은 제출 완료가 아닙니다.
- **자료·Excel:** 원본과 참조 양측 권한, 정확한 과거 FileVersion, 시트·열 매핑·검증·미리보기·원자 적용·내보내기. 잘못된 숫자·공식·외부 링크 등은 명시적으로 검증합니다.
- **공지·문의:** 공개본/대상별 공지 확인, 비공개 문의 초안과 명시 전송, 질문·답변·보완·외부 확인 대기, 팝업/상세 및 저장된 이벤트 복구. 읽음과 답변·업무 완료를 구분합니다.
- **검토·수정·행사:** GSG 내부 의견과 명시 공개 수정 요청, 정확한 제출 대상·반영·해결, PR·행사 메뉴/참여/송장/발송/실물 수령의 별도 사실.
- **일정·앱 알림·검색·감사:** 현재 권한으로 집계·검색하고 출처와 당시 버전을 보존합니다. 앱 내 알림 동기화와 읽음은 실제 이메일 발송이나 외부 cron 수행을 뜻하지 않습니다.
- **외부 진행·완료:** GSG만 수동 완료합니다. 미해결 질문·외부 대기·AI 실패는 강제 차단 조건으로 삼지 않고 완료 당시 잔여 상태를 고정합니다.

일반 첨부는 개당 25MiB, 한 번에 10개입니다. PDF/PNG/JPEG 미리보기와 허용 형식 원본 다운로드를 구분합니다. Supabase에서는 metadata 허가 → Storage 직접 전송 → 서버 finalize를 거쳐 DB 기록을 확정하며, 다운로드는 최신 권한을 검사하는 최대 4MiB 청크로 구성하는 전환 작업을 진행 중입니다. 업로드 허가 URL은 업로드 전용이고 공개 다운로드 URL이 아닙니다.

## 약기법 사전검토 AI

범위는 **일본 일반 화장품의 일본어 POP·리플렛 문안 사전검토**입니다. 약용/의약부외품, 패키지 전체 법률 검토, 범용 업무 AI와 실시간 번역은 제외합니다. 텍스트 10,000자, PDF 10MiB·선택 최대 10페이지, 이미지 최대 4개·합계 10MiB 한도를 유지합니다. 선택·읽음·일부 읽음·읽지 못함·제외 구간을 구별합니다.

공식 근거·업계 지침·리테일러 의견과 정확한 인용 위치, 원문/한국어 번역의 버전·검수 상태를 구분합니다. 근거를 확인하지 못하면 미확인·사람 검토 필요를 반환합니다. 문제 후보 0개는 적법·승인 판정이 아닙니다. AI 결과 공개와 실제 수정 요청은 GSG의 별도 행동입니다.

서버의 `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_BASE_URL`을 사용합니다. `gpt-6 astra`만 같은 모델의 API ID `gpt-6-astra`로 정규화하며 사용자가 지정한 다른 모델로 임의 대체하지 않습니다. 기본 공식 주소는 `https://api.openai.com/v1`입니다. 키 존재 여부와 실제 호출 성공을 구분합니다.

**OpenAI 프로젝트 금액 상한은 없습니다.** 입력 크기·timeout·동시 실행·최대 재시도·중복 방지와 usage를 관리합니다. 알 수 없는 처리 결과는 보존하고 무조건 새 요청을 보내지 않습니다. 합성 데모와 실제 OpenAI 호출을 구분하며, 서버에 허용된 합성/공개 입력만 전송합니다. 실제 메일·상품 기밀·개인 연락처는 fixture/Git/외부 LLM에 넣지 않습니다.

## 검증과 증거

```sh
npm run check
npm run build
npm run db:restart
npm run identity:races
npm run identity:restart
npm run test:install
E2E_PORT=4149 E2E_AUX_PORT=4150 npm run test:e2e
E2E_PORT=4149 E2E_AUX_PORT=4150 npm run test:e2e:db
```

`check`는 lint·타입·단위 검사입니다. E2E wrapper는 desktop/mobile 및 spec마다 새 서버·DB·파일·쿠키를 사용합니다. 사용 중인 포트를 재사용하거나 다른 프로세스를 종료하지 않습니다. `-- --project=mobile`, 파일명, `--grep`, `--list`로 범위를 선택할 수 있습니다. 실제 실행 없이 `--list`한 항목을 통과로 세지 않습니다. `E2E_REPORT`, `E2E_ARTIFACTS`로 새 증거 경로를 지정할 수 있습니다.

이 기본 E2E는 mock/SQLite 검증이며 Supabase 실제 두 서버·두 브라우저 검증을 대체하지 않습니다. Supabase 및 실제 OpenAI 검사는 별도 명령/고유 schema/허용 입력을 사용하고, 해당 결과 패킷에 명령·실제 cwd·후보 commit·종료 코드·PASS/FAIL/SKIP/NOT_RUN·trace/화면/해시를 남깁니다. 구현자와 독립 검증자는 분리하며 통합 commit 회귀까지 통과한 범위만 수용합니다.

전체 대응표는 [.execution/traceability.json](.execution/traceability.json), 필수 조건은 [상세 PRD](docs/execution-v1/01-detailed-prd.md)와 [Goal 매트릭스](docs/execution-v1/02-goal-matrix.md), 최신 Supabase 전환 범위는 [추가 계약](docs/execution-v3/00-supabase-transition.md)에 있습니다. `.execution/private/`의 실제 증거는 비공개·Git 제외이며 실패 기록도 보존합니다. 접근하지 못한 로그를 실제 세션 로그로 만들어 제출하지 않습니다.

## 구조

```text
src/app/                 Next.js 화면과 API
src/features/            기능별 브라우저 UI
src/domain/              업무 타입·검증·관계 제약
src/server/auth,policy/  인증과 서버 권한
src/server/repositories/ mock·SQLite 저장 구현
src/server/postgres/     PostgreSQL·migration·TLS
src/server/storage/      private Storage·허가·읽기·공유 분석 상태
src/server/              업무·상품·제출·문의·AI 등 기능 서비스
scripts/                 migration·seed·실행 검증기
tests/                  단위·브라우저 시나리오
docs/                   PRD·계약·데모·과거 설명
.execution/              상태·결정·대응표; private 증거는 Git 제외
```

## 남은 검증과 운영 한계

현재 Storage 화면 연결과 전체 Supabase 통합·배포 검증을 진행 중입니다. 실제 현업 Excel, 외부 메일/운송·기관 접수, 전문가의 법률 정확도 판정, 상용 백업/복구·부하 검증은 제공되지 않았거나 수행되지 않은 별도 한계입니다. 성공 업로드의 staging 객체는 final과 함께 남을 수 있어 대략 2배 저장 공간을 사용할 수 있으며, 승인된 자동 정리기는 아직 없습니다. 원격에 남은 미참조 final 객체를 임의 삭제하지 않습니다.

최종 수용 commit과 실제 실행 증거가 고정되기 전에는 이 저장소나 현재 배포를 모든 완료 조건을 충족한 제품으로 보고하지 않습니다.
