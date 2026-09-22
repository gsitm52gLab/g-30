# GS HALE 실행 문서 v1

상태: 문서 작성 완료 / 제품 Goal 미실행. 지정 프로젝트는 `/Users/evan/workspace/gs-hale`.

1. [실행 계약·환경·권한](00-execution-contract.md)
2. [상세 PRD 19개·수용 조건 91개](01-detailed-prd.md)
3. [G00~G18 Goal 조건·A01~A26 대응](02-goal-matrix.md)
4. [서브세션 구현·독립 검증·보완·재개](03-agent-workflow.md)
5. [기계 판독 실행 계획](04-run-plan.json)
6. [최종 /goal 프롬프트](05-goal-prompt.md)
7. [기획 v3 로컬 보존본](source-planning-v3.md)

단일 Goal 내부의 19개 체크포인트다. 모든 상태는 PLANNED/NOT_RUN이며 이번 문서 작성의 검증을 제품 테스트 통과로 해석하지 않는다. 구현 시작 때 04 계획을 `.execution/run-plan.json`에 초기화하고 이후 상태를 관리한다. 비공개 실행 증거는 `.execution/private/runs/<run-id>/<Gxx>/<attempt>/`에 저장한다.

검토: 3개 작성 서브세션 및 교차 문서 감사. 초기 검증의 순환, AI 실호출 필수 조건, worktree cwd 불일치를 발견해 수정했다. Git 재초기화 이후 상태 재확인, .env 원본 보존 및 추적 제외. 새 페이지 게시 후 링크/보존 검증은 publication-verification.json에 기록한다.
