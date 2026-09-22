# G03 역할별 홈

PRD-03 AC-03-01~05 / A03, A08, A10, A18, A24. 기준은 execution-v1 PRD와 G14 통합 92eba683이며, 새로운 스키마·인증·가격 규칙을 도입하지 않는다.

- 기본 GSG 범위는 전체 허용 컨텍스트, 브랜드는 내 업무다. 내 업무는 전체 허용 범위에서 GSG owner 또는 브랜드 주/공동담당을 선택한다. 선택 컨텍스트와 전체 허용 범위는 공개된 비담당 업무도 포함하며 제출 권한을 부여하지 않는다. 전달한 context ID는 scope=all/mine일 때도 반드시 서버가 검증한다.
- DTO 집계 전에 기존 context/task/inquiry/notice/campaign/product ACL을 적용한다. GET은 단일 SERIALIZABLE 읽기 UoW의 lazy raw-row memo만 사용한다. 요청간 캐시, ACL 캐시, whole-DB 복제, 쓰기 및 임의 레코드 제한이 없다. 읽기 오류는 전체 집계 실패이며 0건으로 바꾸지 않는다.
- task/owner/assignees/product/current request는 기존 저장값, 목록·칸반·프로젝트 타임라인은 같은 HomeTask DTO다. 기존 /tasks 및 /projects UI도 같은 TaskService.projectTask를 유지하며 담당·공동담당·상품 표기만 보강한다. 숨은 task/project/campaign의 제목·개수는 생성하지 않는다.
- 미답변은 현재 활성 문의에서 resolved가 아닌 질문 수다. 타 브랜드 사용자의 같은 컨텍스트 문의도 기존 initiator 규칙에 따라 제외된다. 정확한 질문 anchor로 이동해 키보드 초점을 둔다. 문의의 외부 확인 담당은 externalWait 담당, 그 외는 연결 업무 GSG owner, 독립 미배정 문의는 담당 확인 필요다. GSG 기본 전체 홈에는 미배정도 포함한다.
- 일정은 scheduleSources + reminderEligibility 원본으로 필요 여부를 판정한다. GSG 전체 집계는 로그인 사용자를 가짜 수신자로 삼지 않고 원본에서 검증한 실제 actionOwner를 사용한다. 이는 알림 발송이 아니다. 오늘은 원본 timezone의 calendar day, 임박은 1~2일, 초과는 이전 날짜다. 기존 날짜 단위 알림 의미를 유지한다. 완료/취소/보류/draft·남은 필수항목0·참여 종료는 제외한다. 미정/needs_confirmation/충돌/담당 미지정은 별도 확인 수치다. external_check는 외부 확인 예정에만 포함하며 초과 미제출 합계에 포함하지 않는다. 같은 task의 서로 다른 필요한 일정은 각각 일정 1건이다.
- 새 제출은 진행 업무 최신 제출에 검토 기록과 공개 보완이 없는 상태다. 과거 요청 제출은 과거 요청 배지를 유지한다. '전달 필요 확인'은 현재 요청 전체 제출 + 변경 요청 없음 검토 기록 + 공개 미해결 보완0 + 동일 제출본의 전달 기록 없음의 확인 후보다. 저장소에 전달 의무 flag가 없어 이 규칙은 명시적 가정이며 필수 의무/전문가 승인/적법으로 단정하지 않는다. 이후 동일 제출본 외부 전달을 기록하면 후보에서 빠진다.
- 브랜드에게 내부 검토·가격·원문, 비공개 공지 초안·미공개 행사 존재를 전달하지 않는다. 완료 업무에서도 공개 미해결 보완/자료 잔여는 0으로 덮지 않고, 고정된 완료 이력과 실제 잔여를 별도로 표시한다.
- PR·행사 신규 /campaigns 목록은 현재 task 및 campaign 권한으로 기존 /tasks/[id]/campaigns에 연결한다. 운영 설정은 최소 role API가 GSG임을 확인한 경우만 보인다. 각 실제 서버 API가 권한을 다시 확인하므로 메뉴 숨김 자체를 권한 검증으로 취급하지 않는다.

## 검증 명령

`npx vitest run tests/unit/home.test.ts` (mock/SQLite 실제 서비스와 canonical fixture)

`GS_HALE_ENV_FILE=/absolute/private/.env HOME_REPORT_DIR=/absolute/private/new-report npx tsx scripts/verify-home-supabase.ts`

두 번째 명령은 배정된 gs_hale_g03_20260922 schema에 additive migration/seed와 고유 합성 업무만 만든다. 기존 record 삭제/초기화 없이 실제 login, HTTP, SSR, PC1280/mobile390, 재접속, 다른 repository 연결, 권한 철회를 검증한다. .env 내용/DSN/예외 원문은 출력하지 않는다. 원본 세션 로그는 실제 session ID/경로를 결과 packet에서 참조한다.

AC-03-04 전체 첨부 흐름은 Supabase Storage 앱 연동 수용 전 NOT_RUN이다. 이 후보의 홈·줄글·문의·메뉴 검증을 파일 업로드 PASS로 대신하지 않는다. G03 최종 수용 또한 독립 검증 및 Storage 후속 실제 브라우저 증거에 달려 있다.
