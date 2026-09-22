# 재개 /goal 프롬프트 v3 — Supabase · g-30

아래 프롬프트는 사용자가 다음 Goal을 재개할 때 사용한다. 이번 준비 작업으로 Goal을 활성화하거나 Supabase 구현 완료를 선언하지 않는다. 기존 미완료 Goal이 있으면 그것을 재개하며 두 번째 Goal을 생성하지 않는다.

```text
/goal
목표:
/Users/evan/workspace/gs-hale에서 기존 GS HALE 구현·검증 이력을 보존하며 Supabase·Vercel에 맞게 완성하고, 상세 PRD의 모든 필수 완료 조건을 독립 검증으로 통과시켜라. 설계나 첫 데모에서 멈추지 말고 구현 → 실행 → 독립 검증 → 보완 → 통합 회귀를 반복한다. 실제 활성 Goal은 하나이고 G00~G18은 그 안의 하위 체크포인트다.

제품 정체성:
- 제품명: GS HALE
- 영문 정의: Healthcare & Aesthetic Launch Enablement
- 대표 슬로건: 해외 헬스케어 진출의 모든 일
- 캠페인 메시지: 글로벌 헬스케어의 새로운 물결
- 발표 첫 문장: GS HALE은 해외 헬스케어 진출에 필요한 모든 일을 하나의 흐름으로 연결해, 글로벌 헬스케어 시장에 새로운 물결을 만드는 플랫폼입니다
위 문구를 원문 그대로 사용한다. 제품명은 앱/README/메타데이터, 영문 정의와 슬로건은 소개/로그인, 캠페인 메시지와 첫 문장은 데모/발표 원고에 반영한다.

반드시 먼저 읽을 자료:
1. docs/execution-v1/00-execution-contract.md
2. docs/execution-v1/01-detailed-prd.md
3. docs/execution-v1/02-goal-matrix.md
4. docs/execution-v1/03-agent-workflow.md
5. docs/execution-v1/04-run-plan.json
6. docs/execution-v3/00-supabase-transition.md — 최신 저장소·배포·Git 권한 지시. 충돌 시 우선
7. docs/execution-v3/01-supabase-setup.md
8. docs/execution-v3/02-supabase-acceptance.json
9. docs/execution-v3/03-main-source-policy.md
10. docs/execution-v3/04-resume-plan.json 및 .execution/run-plan.json / .execution/supabase-acceptance.json — 준비 스냅샷과 실제 실행 원장 구분
11. 최종 통합 기획 https://app.notion.com/p/3e2cee7d6a9b8131b8d1c1ef0dd49898
경로의 AGENTS.md 등 적용 지침과 기존 변경도 확인한다. 최신 사용자 지시를 우선하고 충돌/합리적 가정은 결정 기록에 남긴다. 원문이 불가하면 로컬 보존본을 사용하고 읽지 않은 자료를 읽었다고 쓰지 않는다.

기본 대전제:
GSG 한국법인은 국가×리테일러×브랜드의 컨텍스트별 사용자를 생성·관리하고 특정 사용자에게 신규 입점/스팟 업무를 할당한다. 업무에는 요청 설명, 참고자료, 필수/선택 응답 항목과 마감이 있다. 브랜드는 줄글·값·파일로 부분/전체 제출하고 버전별로 재제출한다. 상품정보 목록·상세·편집·가격 권한·자료/인증·Excel은 독립 필수 기능이다. 공지 확인·수락·제출·검토·외부 전달·실물 수령·업무 완료를 혼동하지 않는다. GSG만 수동 완료하며 미해결/외부 대기/AI 실패를 완료의 강제 차단 조건으로 삼지 않고 잔여 상태를 고정한다. 외부 기관 로그인은 만들지 않는다.

기술과 데이터:
Next.js·TypeScript를 유지한다. 프로젝트 루트는 /Users/evan/workspace/gs-hale이고 origin은 https://github.com/gsitm52gLab/g-30.git이다. 이전 remote legacy-gs-hale, 사용자 변경·.env·기존 모든 worktree/후보/실패 증거를 보존한다. 현재 작업 브랜치 run/supabase-transition에서 이어가며 원격을 다시 초기화하거나 main을 force push하지 않는다. 새 원격 main의 tree가 과거 로컬 조상과 정확히 같음을 확인해 양쪽 이력을 연결한 준비 기록은 execution-v3를 읽는다. 재개 시 최신 Git/원격 상태를 다시 확인하고 변경이 있으면 정상 병합한다. 현재 검증된 제품 기준선 ddb88d940a36f64febd3ecdbd0ceffd380ef3c61의 과거 수용 16/19를 보존하되 Supabase 완료로 간주하지 않는다. G14 전체 통합·G03·G18 및 신규 저장소 수용 조건은 남아 있다.
Vercel https://g-30-pi.vercel.app에서 Supabase PostgreSQL과 private Storage로 동작하도록 전면 전환한다. DATA_SOURCE=supabase를 실제 구현하고 mock은 로컬 합성 회귀용, SQLite는 기존 데이터 보존/필요한 로컬 회귀용으로 분리한다. 배포 DB 실패를 mock으로 fallback하지 않는다. 사용자·로그인 세션/CSRF·업무·상품·제출·문의·공지·보완·완료·일정·알림·검색·감사·AI 실행 기록을 공유 PostgreSQL에 영속화하고 재시작·재로그인·재배포 및 다른 서버 인스턴스/브라우저에서도 유지한다. 기존 자체 인증·권한 의미를 유지하며 Supabase Auth로 바꾸는 것을 필수로 추가하지 않는다.
동기 UnitOfWork를 원격 I/O에 맞게 재설계하고 단일 DB 연결의 실제 transaction 안에서 권한 재확인·revision CAS·관계 제약·감사/멱등 영수증을 원자적으로 처리한다. PostgreSQL JSONB/고유 인덱스/불변 trigger를 기존 최종 SQLite migration 전체와 대응시킨다. SQLite SQL/checksum을 수정하거나 기존 DB/파일을 삭제하지 않는다. 새 PostgreSQL migration/seed는 명시 실행하며 seed는 기존 변경을 보존한다. Supabase의 기존 데이터가 있으면 먼저 읽기 전용 inventory로 충돌·앱 전용 namespace를 확인한다. REST CRUD 여러 호출·프로세스 메모리 lock을 실제 transaction으로 보고하지 않는다.
모든 첨부와 Excel 분석 staging/AI 원본을 private Storage 또는 공유 DB로 전환한다. 25MiB/10개 등 기존 한도를 보존하고 Vercel body 제한을 피해 권한 기반 직접 업로드→서버 finalize를 구현한다. 실제 bytes/hash/크기/signature·소유권·현재 요청 버전·중복을 검사하고 pending/finalized·부분 실패·고아 임시 object를 복구한다. 업로드 허가는 staging에만 발급하고 finalized object를 불변 key로 고정하여 늦은 업로드/허가 재사용/upsert·검증 중 bytes 교체·cleanup 경합이 확정 파일을 바꾸지 못하게 검증한다. 원본/참조 양쪽 권한과 즉시 철회 조건을 유지하는 bounded Range/청크 다운로드·미리보기를 검증하며 장기 signed URL만으로 권한을 대체하지 않는다. /tmp는 동일 실행의 임시 처리에만 사용한다. Excel/OCR/PDF worker와 native 자산의 Vercel 실행·bundle·timeout·메모리 제약도 실제 검증한다.
/Users/evan/workspace/hackathon의 scaffold는 필요한 부분만 읽어 재사용할 수 있으나 통째 덮어쓰기·원본 변경·과거 테스트 결과 전용은 금지한다. 실제 명령 cwd는 배정 worktree 절대경로이며 검증자는 정확한 후보 SHA에서 실행한다. 통합은 지정한 통합 worktree에서 직렬 실행한다.
데이터는 합성으로 만들고 서로 다른 국가, 동일 브랜드의 다른 리테일러, 동일 리테일러의 다른 브랜드, 복수 담당자, 두 업무 분류, 정상/빈/실패/부분 제출·기한/자료 충돌을 포함한다. 실제 메일·상품기밀·개인 연락처를 Git/공개 fixture/외부 LLM/Supabase 테스트 데이터로 전송하지 않는다.

약기법 자료의 기준과 재사용:
약기법 AI를 개발하기 전에 이 프로젝트 Git 저장소의 main 브랜치에 저장된 약기법 관련 내용을 먼저 가져와 참고하고, 적합한 자료는 필요에 따라 사용한다. G00 보완에서 새 origin g-30의 원격 main을 확인·fetch하고 기준 SHA를 기록한다. G15~G17 착수 시 고정한 main의 약기법 원문·출처·번역·corpus·인덱스·규칙·평가셋·관련 코드/README를 실제로 찾아 읽는다. 로컬 main이 비어 있다고 원격 자료도 없다고 판단하지 않는다. 진행 중 작업을 덮는 pull/reset/강제 checkout은 하지 않는다.
재사용할 자료는 일반 화장품 POP/리플렛 적용 범위, 공식 출처·버전/시행일·exact locator·번역 검수 상태와 이용 범위를 확인한다. main에 있다는 이유만으로 현행·정확·검수 완료로 간주하지 않는다. 자료별 main 커밋 SHA·상대 경로·파일 해시·source_id·사용/제외 사유를 source manifest에 남기고 AI corpus 버전 및 구현/검증 패킷에 연결한다. 기존 적합 자료를 우선 활용하고 재수집·변환이 필요하면 이유와 원본 대응을 보존한다. 기밀·개인정보·비밀키는 main에 있어도 외부 LLM으로 전송하지 않는다.
G16 독립 검증자는 고정 main 원본과 사용한 자료·locator·번역/버전을 대조하고, G17은 실제 호출 결과가 그 corpus 버전에 연결되는지 확인한다. G18에서 main 변경 여부와 영향을 확인하고 관련 변경만 재검증한다. 자료 부재·접근 실패·근거 부족은 기록하고 독립 작업을 계속하되 확인하지 못한 원문·조항을 만들어 성공으로 처리하지 않는다. 세부 절차는 docs/execution-v3/03-main-source-policy.md를 따른다.

env와 AI:
DATABASE_URL은 Supabase Transaction pooler 런타임 연결, DIRECT_URL은 migration 전용 Session pooler/허용된 Direct 연결, SUPABASE_URL과 SUPABASE_SECRET_KEY는 서버 Storage 연결, SUPABASE_STORAGE_BUCKET은 private gs-hale-private에 사용한다. 기존 .env를 보존하며 .env.local이 있으면 실제 우선순위를 확인한다. 값을 문서/패킷/로그/클라이언트에 복사하지 않는다. production APP_ORIGIN은 https://g-30-pi.vercel.app이며 로컬/Preview는 각각 검증된 정확한 origin을 사용한다. DB TLS의 서버 인증서와 hostname을 검증하고 필요한 공식 Supabase CA 출처/해시/유효기간을 기록하며 검증을 끄지 않는다. 준비 단계의 두 DB 읽기 전용 접속 성공을 앱 통합 완료로 사용하지 않는다. 설정 존재를 실제 연결 성공으로 쓰지 않는다. 연결 정보가 부족해도 독립 구현은 계속하고 실제 Supabase 검증만 좁은 blocker로 남긴다.
프로젝트 .env의 OPENAI_API_KEY, OPENAI_MODEL, OPENAI_BASE_URL을 서버에서 로드해 사용한다. 비밀값을 출력하거나 문서/패킷/클라이언트에 복사하지 않는다. 현재 모델 표기 gpt-6 astra는 같은 모델의 공식 API ID gpt-6-astra로 정규화하고 이유만 기록한다. 이후 사용자가 모델을 바꿨다면 최신 설정을 읽고 임의 다른 모델로 대체하지 않는다. API 키의 존재만으로 호출 성공을 판단하지 말고 G17에서 합성/허용 공개 입력으로 실제 최소 호출·결과 schema·근거·usage·실패 경로를 검증한다.
AI는 일본 일반 화장품의 일본어 POP/리플렛 문안 사전검토만 구현한다. 텍스트/PDF/이미지에서 읽은 범위와 못 읽은 범위를 구별한다. 약용/의약부외품, 패키지 전체 법률검토, 범용 업무 AI, 실시간 번역은 제외한다. 공식 근거/업계 지침/리테일러 의견을 분리하고 exact locator를 검증한다. 근거를 찾지 못하면 미확인과 사람 검토 필요를 반환한다. 문제 후보 0개를 적법/승인으로 표시하지 않는다. 원문·한국어 번역의 버전/검수 상태를 보존하고 과거 번역은 현행 검색에서 제외한다.
OpenAI 사용 금액의 프로젝트 상한은 없다. 과거 $10/$8/$9.50 조건을 복원하지 않는다. 대신 입력 크기·timeout·동시 실행·최대 재시도·중복 방지와 usage 기록으로 안정성을 관리한다. 비용을 이유로 필수 테스트를 임의 생략하지 않고 불필요한 반복 호출도 하지 않는다.

진행 방식:
메인은 계획·의존 관계·결정·통합·증거 검토를 맡는다. 구체적인 PRD별 구현과 검증은 서브세션에 위임한다. 최대 메인 1+서브세션 3을 기본으로, 독립 작업만 병렬화한다. 실제 도구의 동시 슬롯 한도를 따른다. 공통 스키마/인증/lockfile을 여러 세션이 동시에 수정하지 않도록 파일 소유권과 선행 계약을 고정한다. Git worktree 또는 동등한 격리 체크아웃, 세션별 DB/파일/포트를 사용한다. 비밀값은 필요한 서버/연동 검증에만 주입한다.
각 task packet에는 Goal/PRD/AC ID, source revision, base commit, 허용 파일, 금지 범위, 선행 결과, fixture, 실행 검증 방법, 예상 결과, 증거 경로를 넣는다. 구현자는 candidate commit·변경·테스트 결과를 반환한다. 해당 기능을 구현하지 않은 별도 검증 서브세션이 그 정확한 candidate를 독립 실행한다. 검증자는 실패를 발견하면 직접 코드 고쳐 PASS하지 말고 재현 조건/증거를 돌려준다. 메인은 수정 작업을 배정하고 새 candidate를 다시 검증한다.
결과 packet에는 실제 명령/cwd/종료 코드, 테스트·통과/실패/미실행 수, commit, 세션 ID, artifact, 열린 결함과 재현법을 포함한다. PASS 문구만 수락하지 말고 증거 파일과 결과를 확인한다. 독립 검증 후 통합하고 통합 commit에서 영향을 받는 회귀를 통과해야 ACCEPTED다. 필요한 선행 작업이 ACCEPTED일 때만 의존 작업을 시작한다. 독립된 가지는 다른 가지의 외부 장애와 무관하게 계속한다.

완료 조건:
PRD-00~18의 모든 필수 AC와 G00~18, 원안 A01~A26 및 execution-v3의 SB-01~SB-18 대응 조건을 추적표로 관리한다. 기존 207행 최종 감사 세부 항목은 삭제하지 않고 Supabase 신규 18행을 추가한다. 제품 기능/실제 API 연동/실운영 적합성을 분리한다. 모든 필수 화면의 실제 저장·오류·정상/빈/경계 입력·교차 컨텍스트 접근 거부·가격 비노출·중복/동시 변경·DB 영속성을 검증한다. 상품정보와 신규 입점/스팟·줄글/파일 흐름이 빠지면 완료 불가다. PC와 모바일에서 Playwright로 핵심 사용자 흐름을 검증하고 trace/스크린샷을 남긴다. 브라우저 역할 전환만으로 서버 권한 통과라 쓰지 않는다.
설치부터 dev/build/test, migration/seed, mock 및 실제 Supabase 실행을 README대로 재현한다. 서로 다른 두 프로세스·두 브라우저, 새 PID·재배포 후 데이터/세션/파일 유지와 실제 Vercel 큰 첨부·Excel·OCR를 검증한다. 기존 SQLite/mock 통과를 Supabase/Vercel 증거로 쓰지 않는다. Supabase 실제 통합·배포 검증이 접근 제한으로 미실행이면 해당 필수 조건과 Goal은 미완료다. 최종 accepted commit을 고정하고 독립 서브세션이 누락·회귀·권한·AI 한계·문서 일치까지 최종 감사한다. 실패/skip/검증 미실행을 통과 분모에서 숨기지 않는다. 기술적 전체 완료는 필수 제품 기능과 실제 Supabase DB/Storage·Vercel 배포 동작·명시된 OpenAI 연동이 검증됐을 때만 인정한다. 실제 현업 Excel/외부 메일/전문가 판정/상용 운영은 제공되지 않은 경우 미검증 한계로 구분하며 대체 fixture를 실운영 증거라 쓰지 않는다.

자율성과 차단 처리:
사소한 설계·구현 선택은 합리적으로 판단해 기록하고 질문 때문에 멈추지 않는다. 실패하면 원인 분석과 수정/재검증을 반복하며 같은 실패 3회 시 증거와 접근법을 재검토하고 독립 조사에 배정한다. 단순히 3회라는 이유로 포기하지 않는다. 외부 권한·누락된 자격증명·반드시 사람이 해야 하는 결정만 좁은 blocker로 남기고 다른 필수 작업을 계속한다. 도구/네트워크 한계로 실제 독립 검증을 못 했다면 그런 검증을 수행했다고 쓰지 않는다. 완료할 수 없는 필수 항목이 남으면 Goal 전체 완료로 바꾸지 않는다.
프로젝트 코드/문서·합성 데이터·의존성·로컬 실행/검증/수정·commit/통합, 사용자 지정 Supabase 앱 전용 schema/private bucket의 비파괴 준비와 합성 통합 검증, 기존 허용 OpenAI 실제 호출을 진행한다. 사용자는 g-30 저장소에 커밋 후 push를 허용했다. 비밀값/실데이터/세션 원문·사적 증거 제외와 검사 결과를 확인한 커밋을 명시한 현재 브랜치에 non-force push하고 원격 SHA를 기록한다. 기존 Vercel Git 연동이 push로 자동 build/deployment를 시작할 수 있음을 기록한다. 원격 main 최신 내용을 재검토하고 최종 검증 전 main 덮어쓰기/삭제/강제 push는 하지 않는다. 새 결제/요금제 변경·배포 보호 해제·새 공개 대상 생성·별도 수동 production promotion·실제 메일·실데이터 외부 전송·기존 데이터 삭제·파괴적 Git은 추가 지시 없이 진행하지 않는다. 앱이 소유한 만료 임시 object와 격리 테스트 prefix만 제한된 정리 대상으로 삼는다. .env와 사용자 변경을 보존한다.

기록·재개·최종 결과:
.execution에 작업 상태/의존관계/시도/accepted commit/next action을 원자적으로 갱신하고 세션 종료·컨텍스트 압축 후 이를 읽어 이어간다. 실패 결과를 삭제하거나 재시도 성공만 남기지 않는다. 실제 세션 로그는 확인된 원본 경로/세션 ID/해시와 수집 상태를 보존하고 민감 원본과 제출용 비식별 사본을 분리한다. 접근할 수 없는 JSONL을 만들어 실제 로그라고 하지 않는다.
실행 가능한 코드, 합성 데이터, README, 전체 PRD 대응표, 검증 증거, 데모 시나리오/발표 원고와 남은 한계를 남겨라. 최종 보고는 완성한 기능, 실제 Supabase/Vercel/OpenAI 검증과 미실행, 실행 명령/경로, accepted commit, push한 branch/remote SHA, artifact/로그 위치, 열린 blocker를 간단히 정리한다. 사용자 지시 없이 원격 제출이나 공개까지 완료했다고 말하지 않는다.
```
