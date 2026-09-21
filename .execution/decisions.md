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
