# GS HALE 실행 계약 v3 — Supabase · g-30

작성일: 2026-09-22. 변경 ID: `SUPABASE-20260922-01`.

이 문서는 사용자의 최신 변경 지시를 다음 Goal 실행에 반영한다. **이번 단계는 계약·재개 프롬프트·Git 연결 준비이며 Supabase 구현 또는 실제 연동 완료가 아니다.** 플랫폼 Goal은 `paused`로 확인했고 사용자가 다시 실행하기 전 활성화하지 않는다. v1의 PRD·91개 AC·A01~A26와 기존 기능은 유지한다. 충돌하는 저장소·원격 push 조건에만 이 문서가 우선한다. 과거 기획과 비추적 `docs/execution-v2/`는 덮어쓰지 않는다.

## 확정 변경

| 항목 | 새 기준 |
| --- | --- |
| 프로젝트 | `/Users/evan/workspace/gs-hale`, Next.js·TypeScript |
| 배포 대상 | 기존 Vercel 앱 `https://g-30-pi.vercel.app` |
| 배포 DB | Supabase PostgreSQL. `DATA_SOURCE=supabase`는 구현할 새 설정이며 현재 코드는 아직 지원하지 않음 |
| 영구 첨부파일 | Supabase Storage의 private 버킷 `gs-hale-private` |
| 로그인 | 기존 GS HALE 계정·초대·권한을 유지하고 세션·CSRF·차단 기록을 공유 PostgreSQL에 저장. Supabase Auth로 별도 재설계하지 않음 |
| mock / SQLite | 로컬 fixture·회귀 및 과거 데이터 읽기 용도로 보존 가능. Vercel의 실제 저장 성공을 대체하지 않음 |
| origin | `https://github.com/gsitm52gLab/g-30.git` |
| 이전 remote | `legacy-gs-hale`로 보존. 자동 push 대상이 아님 |
| 준비/통합 브랜치 | `run/supabase-transition`. 기존 `run/integration`과 모든 worktree/후보·증거 보존 |
| Git 권한 | 이 저장소에 프로젝트 코드·문서의 검토된 로컬 커밋을 생성하고 non-force push하는 것을 사용자가 허용 |

## Git 연결과 재개 기준

새 원격 main `85bcb50ce95d574b20c477303c7d262a8fc779b7`은 이전 이력과 공통 조상이 없는 초기 커밋이다. 그러나 tree `bf0f940bd06e4f3ee5df16cc49cc2ada2ed1f604`는 기존 로컬 조상 `f3f868c05fcb03eed72d94cc2d56175046cf5b05`의 tree와 **정확히 동일**했다. 새 원격에만 있는 파일도 없었다. 따라서 최신 로컬 기준 `4b69cce6b3cfe605dc7a5c452da99eee296a0c57`을 보존하는 merge로 두 이력을 연결한다. 이는 검증한 과거 사본에 한정한 판단이며 이후 다른 변경을 `ours`로 무시할 권한이 아니다.

현재 검증된 제품 기준선은 `ddb88d940a36f64febd3ecdbd0ceffd380ef3c61`, 과거 환경에서 수용한 단계는 16/19다. G14 전체 통합·G03·G18은 미완료다. G14 UI 독립 후보 `25ae3614`, provider consumer 후보 `01f09c0f`, 예비 합본 `4093417`과 도착한 패킷을 재개 때 검토한다. 기존 결과를 잃거나 전부 처음부터 구현하지 않는다. 이 통과 기록은 **Supabase 통과 기록이 아니며** 모든 영향을 받는 경로를 새 저장소에서 재검증한다.

실행 원장은 `.execution/run-plan.json`, 신규 보완 조건은 `02-supabase-acceptance.json`, 재개 지시는 `04-resume-plan.json`이다. G00~18 안에 Supabase 보완 체크포인트를 연결한다. 새 활성 Goal 여러 개를 만들지 않는다.

## DB 구현 계약

1. 공통 저장 인터페이스·도메인 서비스·권한 검사·제약 검사에 원격 PostgreSQL의 비동기 I/O를 반영한다. 단일 연결의 실제 트랜잭션으로 권한 재검사, revision CAS, 여러 레코드 변경, 감사/멱등 영수증을 함께 commit 또는 rollback한다. REST CRUD 호출 여러 개를 트랜잭션으로 부르지 않는다. 프로세스 메모리 lock이나 일부 레코드 캐시를 공용 DB의 동시성 보장으로 사용하지 않는다.
2. 기본 구현 방향은 async UnitOfWork와 PostgreSQL adapter다. `pg`/Postgres.js 등 실제 선택한 공식 클라이언트의 연결/풀링/timeout 설정을 문서화한다. 서버 인증서·hostname을 검증하는 TLS를 사용하고 필요한 공식 Supabase CA 출처/해시/유효기간을 기록한다. 인증서 검증을 끄지 않는다. Transaction pooler와 호환되지 않는 named prepared statement·세션 상태·세션 advisory lock에 의존하지 않는다. 네트워크 I/O를 장시간 DB transaction 안에 두지 않는다.
3. 기존 SQLite SQL 원본/checksum을 수정하지 않고 별도의 PostgreSQL migration을 만든다. 최종 통합 시 실제 SQL 목록을 다시 센다. 현재 수용본은 0001~0015이며 G14 후보의 0016도 통합 대상이다. JSONB, 부분/표현식 고유 인덱스, 불변 이력 trigger, FK/참조 무결성, 예외적 legacy 상품 context 이동, revision, 순서, request hash, 만료 상태를 항목별 대응표로 보존한다.
4. migration은 명시적으로 실행한다. runtime 시작/GET마다 migration·seed하지 않는다. seed는 합성 레코드만 누락 삽입하고 기존 사용자 변경을 보존한다. SQLite 데이터/첨부가 있으면 먼저 현황·복사본·해시를 확보하고 별도 import로 ID/버전/시간/파일 hash를 보존한다. 원본 삭제와 강제 reset은 금지한다.
5. DB secret은 서버 전용이다. 앱 전용 schema와 최소 권한을 설계하고 `anon`/브라우저에서 테이블·가격·세션을 직접 읽지 못하게 한다. Supabase service secret은 RLS를 우회하므로 기존 서버 권한 검사를 반드시 유지하고 직접 Data API 접근 거부도 검증한다. DB 장애를 mock으로 자동 대체하지 않는다.

## 파일·Excel·AI 입력 계약

1. 일반 요청/상품/제출/문의 첨부, AI 입력 원본, Excel 분석 staging을 모두 조사한다. 파일 본문은 private Storage에, 버전/소유권/정확한 object key/크기/MIME/hash/상태는 PostgreSQL에 둔다. 원본·참조 양쪽 권한, 가격 비노출, 내부 자료와 공개 요청의 구별을 보존한다.
2. 일반 첨부의 25MiB/10개와 Excel·AI의 기존 한도를 줄이지 않는다. Vercel 함수 요청/응답 body 제한 때문에 25MiB 전체를 일반 API body로 중계하는 방식은 채택하지 않는다. **서버 권한 확인 → 경로·크기·만료가 제한된 업로드 허가 → 브라우저의 Storage 직접 업로드 → 서버 finalize** 흐름을 구현한다. Supabase 표준/재개 업로드 중 공식적으로 지원되는 방식을 검증해 사용한다.
3. finalize는 클라이언트가 보낸 MIME/hash/경로를 신뢰하지 않는다. 실제 object의 크기·signature·SHA-256, 현재 사용자/context/업무/요청 버전, 중복 키를 확인한 뒤에만 제출 자료로 노출한다. 허가 뒤 권한이 철회되면 finalize와 읽기를 거부한다. 업로드 허가는 staging 경로에만 발급하고 finalized object는 서버만 생성하는 별도 불변 key로 고정한다. 허가 재사용·늦은 재개 업로드·upsert로 확정 파일을 덮어쓸 수 없어야 한다. 검증 도중 bytes 교체, 최종 object hash/크기 재확인, finalize와 cleanup 경합을 검사한다. Range 응답도 고정한 동일 object 버전의 bytes만 반환한다.
4. DB와 Storage는 하나의 ACID transaction이 아니다. pending/finalized 상태, retry receipt, 부분 실패, 업로드 후 DB 실패, 고아 object, 만료 허가를 복구 가능하게 설계한다. 정리는 앱이 만든 만료 임시 object와 명시적으로 소유한 테스트 prefix에만 제한하고 기존 사용자 자료는 삭제하지 않는다.
5. private 객체의 장기 signed URL을 권한 검사 대체물로 사용하지 않는다. 권한 철회 이후 새 읽기와 후속 바이트 요청을 차단해야 한다. 대용량 다운로드/미리보기는 각 요청에서 현재 권한을 검사하는 bounded Range/청크 전달 등 Vercel 제한을 지키는 방식을 우선 검토하고 실제 브라우저로 검증한다. signed URL을 선택한다면 철회 계약을 충족하는 설계/증거가 먼저 필요하며 짧은 TTL만으로 즉시 철회를 달성했다고 쓰지 않는다.
6. `/tmp`는 현재 실행의 bounded 임시 parser 작업에만 사용한다. Excel staging의 재요청/만료/가격 권한은 공유 DB/Storage에 보존한다. PDF/OCR worker, native 모듈, 일본어 학습자료, child process/프로세스 정리와 Excel worker의 배포 bundle·메모리·시간을 실제 Vercel에서 확인한다. OCR나 큰 첨부를 제거해서 배포 성공으로 만들지 않는다.

## 다중 인스턴스·AI·화면 계약

로그인/CSRF/초대/정지/authVersion/로그아웃, 데이터 변경, SSE cursor/권한 철회, 알림 중복 방지, AI claim/lease/attempt/outcome/usage를 모두 공유 DB 기준으로 동작시킨다. 서로 다른 두 서버 프로세스와 서로 다른 두 브라우저가 동일 기록을 관찰해야 한다. 서버 재시작·재배포·다른 인스턴스로 요청이 이동해도 세션/업무/파일/실행 결과를 유지한다. 외부 호출의 exactly-once를 과장하지 않고 기존 RESPONSE_UNKNOWN 및 명시적 재시도 동의 흐름을 보존한다.

일본 일반 화장품 POP/리플렛 AI 범위, 원문/번역 버전·locator·미확인·사람 검토, GSG 수동 완료, 신규 입점/스팟·상품정보·부분 제출 등의 기존 필수 기능과 UI를 축소하지 않는다. OpenAI 프로젝트 금액 상한 없음 및 기술적 제한/usage 관측도 유지한다. 새 원격 main의 약기법 자료는 `03-main-source-policy.md`로 출처를 다시 연결한다.

## 허용과 금지

- 지금은 준비 문서·Git 연결·로컬 commit·해당 브랜치 push를 진행한다. 실제 Goal은 사용자가 재실행한다.
- Goal 재개 후 코드/테스트/문서/합성 fixture 변경, 격리 환경 실행, 사용자 제공 Supabase 프로젝트의 앱 전용 schema/private bucket 준비 및 합성 입력 통합 검증, 기존 허용 OpenAI 최소 실호출, 로컬 commit/non-force push를 수행한다. 기존 데이터가 있으면 먼저 읽기 전용 inventory와 충돌 검사를 한다. 범위 밖 object/table/권한은 변경하지 않는다.
- push는 검토한 현재 작업 브랜치의 명시 ref만 전송한다. `--all`, `--mirror`, force push, 원격 branch 삭제, destructive reset은 금지한다. 사전 검사에서 비밀값/실데이터/세션 JSONL/사적 증거가 들어 있으면 commit/push를 멈추고 안전하게 보완한다. `main`은 최종 검증과 최신 원격 변경 검토 후 정상 병합으로만 갱신한다.
- 사용자는 커밋 후 push를 허용했다. 기존 Vercel Git 연동의 자동 build/deployment가 push로 시작될 수 있음을 기록한다. 배포 보호 해제, 새 공개 대상 생성, 별도 수동 production promotion, 새 결제/요금제 변경, 실제 메일, 실데이터 외부 전송은 별도 허용 없이 수행하지 않는다.
- 실제 Supabase/Vercel 검증이 자격증명 또는 배포 접근에 막히면 해당 조건은 BLOCKED/NOT_RUN으로 남긴다. 독립된 로컬 구현을 계속하고 필수 배포 검증 전 전체 완료로 바꾸지 않는다.

## 참고한 공식 문서

- [Supabase PostgreSQL 연결](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase 서버 API key](https://supabase.com/docs/guides/getting-started/api-keys)
- [Private Storage](https://supabase.com/docs/guides/storage/buckets/fundamentals)
- [재개 가능한 업로드](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [Vercel 함수 제한](https://vercel.com/docs/functions/limitations)

문서상 가능 여부와 실제 프로젝트 통과는 구분한다. 앱의 Supabase/Vercel 통합 수용 검증은 NOT_RUN이다. 준비 진단으로 두 DB pooler의 TLS 검증·READ ONLY SELECT 1과 Storage 버킷 목록 HTTP 200을 확인했으며 원격 데이터 변경은 0회다. 앱 테이블/private 버킷은 아직 준비되지 않았다. 상세 진단은 연결 준비 문서와 재개 지시에 기록한다.
