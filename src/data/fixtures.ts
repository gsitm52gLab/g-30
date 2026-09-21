import type { RecordInput, RecordKind } from "@/domain/records";
export const FIXTURE_VERSION = "synthetic-g00-v1";
export const FIXTURE_TIME = "2026-09-21T00:00:00.000Z";
type Seed = { [K in RecordKind]: { kind: K; input: RecordInput<K> } }[RecordKind];
export const fixtures: Seed[] = [
  ...[
    ["ctx-jp-a-luna", "일본", "리테일러 A", "루나랩"],
    ["ctx-jp-b-luna", "일본", "리테일러 B", "루나랩"],
    ["ctx-jp-a-wave", "일본", "리테일러 A", "웨이브랩"],
    ["ctx-sg-a-luna", "싱가포르", "리테일러 A", "루나랩"],
  ].map(([id, country, retailer, brand]) => ({ kind: "context" as const, input: { id, contextId: null, data: { country, retailer, brand } } })),
  { kind: "user", input: { id: "user-gsg", contextId: null, data: { name: "가상 운영자", email: "operator@example.test", role: "gsg" } } },
  { kind: "user", input: { id: "user-luna", contextId: null, data: { name: "가상 루나 담당", email: "luna@example.test", role: "brand" } } },
  { kind: "user", input: { id: "user-wave", contextId: null, data: { name: "가상 웨이브 담당", email: "wave@example.test", role: "brand" } } },
  { kind: "product", input: { id: "product-serum", contextId: "ctx-jp-a-luna", data: { name: "루나 데일리 세럼", code: "DEMO-LUNA-001", brand: "루나랩", size: "30 mL", category: "스킨케어", status: "draft", missingMaterials: 1 } } },
  { kind: "product", input: { id: "product-cream", contextId: "ctx-jp-b-luna", data: { name: "루나 모이스처 크림", code: "DEMO-LUNA-002", brand: "루나랩", size: "50 mL", category: "스킨케어", status: "active", missingMaterials: 0 } } },
  { kind: "product", input: { id: "product-balm", contextId: "ctx-jp-a-wave", data: { name: "웨이브 립밤", code: "DEMO-WAVE-001", brand: "웨이브랩", size: "10 g", category: "립케어", status: "draft", missingMaterials: 2 } } },
  { kind: "task", input: { id: "task-onboarding", contextId: "ctx-jp-a-luna", data: { title: "신규 입점 상품 기본자료 준비", category: "onboarding", assigneeId: "user-luna", ownerId: "user-gsg", description: "합성 시나리오입니다. 상품 소개와 성분 자료를 준비하고 남은 자료를 확인합니다.", status: "partial", deadline: "2026-09-25", nextAction: "남은 성분 자료 확인", productIds: ["product-serum"], notes: ["요청 3개 중 2개 제출 상태의 합성 예시", "인증 관련 자료의 적용 범위 확인 필요"] } } },
  { kind: "task", input: { id: "task-pop", contextId: "ctx-jp-a-luna", data: { title: "매장 POP 문안 업데이트", category: "spot", assigneeId: "user-luna", ownerId: "user-gsg", description: "일본어 POP의 문안과 확인용 PDF를 준비하는 독립 스팟 업무 예시입니다.", status: "requested", deadline: null, nextAction: "GSG 담당자에게 제출 기한 확인", productIds: ["product-serum"], notes: ["기한 미정", "원문 자료의 사용 일정이 서로 달라 확인 필요"] } } },
  { kind: "task", input: { id: "task-wave", contextId: "ctx-jp-a-wave", data: { title: "샘플 패키지 자료 확인", category: "spot", assigneeId: "user-wave", ownerId: "user-gsg", description: "파일 자료와 실물 수령을 분리하는 합성 업무 예시입니다.", status: "in_progress", deadline: "2026-09-28", nextAction: "자료 버전 확인", productIds: ["product-balm"], notes: [] } } },
];
