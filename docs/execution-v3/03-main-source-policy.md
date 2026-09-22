# 새 origin/main의 약기법 자료 사용

사용자의 기존 지시를 유지한다. 약기법 AI 구현·수정 전에 `https://github.com/gsitm52gLab/g-30.git`의 최신 main을 non-destructive fetch하고 SHA를 고정한다. 자료 목록은 source manifest에 저장하며 준비 단계에서 단순히 tree를 비교한 것을 corpus 검수로 보고하지 않는다.

1. 고정 main의 원문·공식 출처·버전/시행일·일본어/한국어 자료·corpus·인덱스·규칙·평가셋·관련 코드를 실제로 찾아 읽는다. 해당 자료가 없으면 없는 것으로 기록한다.
2. 일반 화장품 POP/리플렛 적용 범위와 exact locator·번역 검수 상태·사용 허용 여부를 확인한다. 공식 근거/업계 지침/리테일러 의견을 분리한다. main에 있다는 이유로 현행·정확·전문가 승인으로 보지 않는다.
3. repository URL, main SHA, 경로, 파일 hash, source_id/버전, 사용·제외 이유를 구현·검증 패킷과 AI corpus 버전에 연결한다. 이전 원격에서 검증한 동일 자료를 재사용할 때는 양쪽 SHA/경로/hash의 대응과 최신성 한계를 보존한다.
4. 비밀키·실제 메일·기밀·개인정보는 main에 있어도 Git 재게시/외부 LLM 입력으로 사용하지 않는다. 실제 호출 입력은 합성 또는 허용 공개 자료에 한정한다.
5. G16 독립 검증은 원본과 locator/번역/stale 상태를, G17은 실제 결과와 corpus 버전 연결을, G18은 main 변경 영향과 누락을 검사한다. 자료 부재·권한 부족·미확인은 열린 상태로 남기고 독립 작업을 계속한다.

진행 중 checkout을 덮는 pull/reset/force checkout은 금지한다. 현재 준비 시점에 fetch한 main SHA는 `85bcb50ce95d574b20c477303c7d262a8fc779b7`이며 다음 Goal 재개 때 다시 최신 여부를 확인한다. 이번 단계에서는 약기법 원문을 새로 검수하지 않았다.
