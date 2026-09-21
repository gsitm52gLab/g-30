# G16 순수 계약 — 저장·API 연결 전

이 단계는 `src/domain/ai-review`의 입력·근거·결과 계약이다. G16 서비스, 권한, 실행, 사람 검토 이력, UI 또는 실제 법률 정확도를 완료한 단계가 아니다. API/provider 호출은 없다. 이 문서와 순수 단위 테스트를 G16 수용 기준의 실제 실행 PASS로 세지 않는다.

## 채택한 자료

`curated.json`에는 2026-09-22 기준 직접 읽은 6개 자료에서 최소 일본어 발췌 16개, 그 발췌에 정렬된 비공식 한국어 16개만 담는다. source version은 원본 문서 바이트 해시·개정 식별자·공식 URL·실제 읽은 범위를 유지한다. 원본 PDF/이미지/전체 가이드와 비공개 준비 경로는 포함하지 않는다. JCIA 인용은 2구절, 총 32개 일본어 문자이며 업계 자율 지침이다. MHLW가 호스팅하는 2011년 문서의 업계 첨부를 공식 통지로 취급하지 않는다. 시행일이 확인되지 않은 통지는 발행일을 시행일로 추정하지 않는다.

모든 한국어는 `machine_unreviewed`, 비공식, 사람 검수자/시각 없음이다. 배포 자료를 추가한 사실은 법률 전문가의 검수나 현행 전체 법령을 읽었다는 뜻이 아니다. 런타임 번역은 없다. 판매 No.1의 조사 근거·조건과 효능/안전성 보증의 문맥 차이, 건조 잔주름의 조건, 2025년 성분 통지의 1985년 통지 폐지 등은 각 발췌의 `contextNote`에 보존한다.

## 실제 함수와 경계

- `curatedRelease()`는 최소 정렬 자료를 검증하여 배포 제안 release를 만든다. DB publication은 하지 않는다.
- `createCorpusRelease(unknown)`는 알려진 필드를 명시 투영하고 JP/KO 해시·정렬 관계·권위·URL·정확 위치 형식을 검증한다. malformed known 값은 `CORPUS_INVALID`, 정상 unknown extension은 출력에서 제거된다. 배열은 ID 순으로 정렬한다. `readCorpusRelease`는 저장된 manifest hash도 비교한다.
- `selectCurrentCorpus(release, currentSourceHeads)`는 현재 source version ID와 원본 해시가 모두 같은 발췌만 검색 대상으로 반환한다. 변경되거나 head가 없는 JP/KO는 제외하며 제외 ID를 반환한다. 과거 release는 다시 쓰지 않는다. 서비스는 배포자의 실제 current heads를 공급해야 한다. 과거 실행의 인용은 당시 immutable release를 그대로 읽고 현재와의 차이를 별도로 표시한다.
- `validateInputQuote(snapshot, contextId, expectedHash, quote)`는 G15 snapshot hash/문맥/읽힌 unit/선택 페이지/구간·문자열을 확인한다. quote는 `segmentId,start,end,quote`만 소비하며 provider의 페이지·상자·URL을 신뢰하지 않는다. offset은 G15와 같은 UTF-16 code unit이다. OCR 부분 인용은 enclosing segment box이며 단어별 상자를 만들지 않는다. 원문 발췌 위치의 layout-normalized offset은 별도 Unicode code-point 방식으로 표시한다.
- `validateAnalysisResult(raw, snapshot, contextId, expectedHash, release, currentHeads)`는 256 KiB/100후보 상한 아래 명시 projection을 수행한다. 입력 원문 위치 오류/지원 제외 분류/잘못된 known 값은 인덱스와 안전한 사유로 quarantine한다. 잘못된 JSON은 `RESULT_INVALID`이며 후보 0으로 바꾸지 않는다. 원 raw는 반환하지 않고 해시만 돌려준다; 향후 내부 서비스가 별도 보존한다.
- 인용은 `excerptId,sourceVersionId,locator`가 선택된 corpus와 정확히 일치해야 한다. `legalBasis`는 법령/공식 통지, `supportingGuidance`는 업계 지침이다. 리테일러 의견은 이 corpus에서 법적 근거로 등록할 수 없다. unknown source/locator를 새 조항으로 생성하지 않는다. 보조 지침만 있거나 공식 위치가 없으면 `unconfirmed`이다. 확정된 locator도 위법성 판단 또는 번역 검수 완료가 아니다.
- 위험과 확신도는 별도 필드다. `requiresHumanReview:true`, `legalApproval:false`는 항상 유지한다. 부분 추출/근거 corpus 부재/번역 미검수는 limitations에 남긴다. 근거 부재는 후보가 0이어도 `unconfirmed`다. 입력의 실행 지시와 tool_calls는 실행하지 않는다.
- `parseHumanReview`는 수락/수정/기각과 사유·expectedRevision을 구별한다. 이 함수는 권한을 부여하거나 원문을 수정하거나 이력을 저장하지 않는다. 실제 GSG fresh authorization/CAS/append-only 기록은 다음 서비스 단계의 책임이다.

G15의 실제 `extractInput` 텍스트 producer를 단위 테스트가 소비한다. OCR/PDF 위치 반례는 명시적인 합성 snapshot이며 새 OCR 실행 증거가 아니다. 모델/provider 출력 검증 예시는 합성 계약 검사이며 법률 ground truth나 모델 성능 점수로 사용하지 않는다.

## 다음 등록 단계의 필수 조건

현재 pure 함수는 **현재 사용자 권한 검사 대체물이 아니다**. 서비스는 G15의 저장된 입력/버전/run/snapshot/원본 파일과 G05 exact submission/ProductUse 관계를 fresh UoW에서 확인하고, 실행 저장 직전 다시 검사해야 한다. 입력 모델·prompt·corpus·rawresult 버전은 불변으로 기록한다. GSG 내부 결과/사람 검토를 브랜드에 자동 공개하지 않는다. G10 공개 수정 흐름과 G11 실제 실패 잔여 연결, SQLite 영속성·동시 수정·새 PID·실제 권한·UI는 후속 구현/검증 대상이다.

`npm test -- tests/unit/ai-review-corpus.test.ts tests/unit/ai-review-results.test.ts`로 순수 계약을 검사한다. 공통 schema/migration/API/package/lockfile은 이 단계에서 수정하지 않는다. 실제 OpenAI와 최신 환경 모델 설정은 G17 담당이며 G16 합성 엔진을 실제 호출로 표시하거나 실패 시 조용히 대체하지 않는다.
