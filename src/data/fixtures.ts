import type { RecordInput, RecordKind } from "@/domain/records";
export const FIXTURE_VERSION = "synthetic-g01-v1";
export const FIXTURE_TIME = "2026-09-21T00:00:00.000Z";
type Seed = {
    [K in RecordKind]: {
        kind: K;
        input: RecordInput<K>;
    };
}[RecordKind];
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
// G01 explicit synthetic upgrade map; role gsg is NOT an administrator grant.
const contextDefinitions: Record<string, {
    countryId: string;
    retailerId: string | null;
    brandId: string;
    type: "retail" | "event";
}> = {
    "ctx-jp-a-luna": { countryId: "JP", retailerId: "retailer-a", brandId: "brand-luna", type: "retail" },
    "ctx-jp-b-luna": { countryId: "JP", retailerId: "retailer-b", brandId: "brand-luna", type: "retail" },
    "ctx-jp-a-wave": { countryId: "JP", retailerId: "retailer-a", brandId: "brand-wave", type: "retail" },
    "ctx-sg-a-luna": { countryId: "SG", retailerId: "retailer-a", brandId: "brand-luna", type: "retail" },
};
for (const item of fixtures) {
    if (item.kind === "context") {
        const d = contextDefinitions[item.input.id];
        Object.assign(item.input.data, d, { combinationKey: `retail:${d.countryId}:${d.retailerId}:${d.brandId}` });
    }
    if (item.kind === "user")
        Object.assign(item.input.data, { normalizedEmail: item.input.data.email.toLowerCase(), status: "active", authVersion: 1, adminGrant: null });
    if (item.kind === "task")
        Object.assign(item.input.data, { authorId: item.input.data.assigneeId, contributorIds: [], assignmentNeedsAttention: false });
}
fixtures.push({ kind: "context", input: { id: "ctx-event-luna", contextId: null, data: { country: "일본", retailer: "리테일러 미지정", brand: "루나랩", countryId: "JP", retailerId: null, brandId: "brand-luna", type: "event", eventName: "합성 독립 행사", combinationKey: "event:JP:brand-luna:합성 독립 행사" } } }, { kind: "context", input: { id: "ctx-empty", contextId: null, data: { country: "일본", retailer: "리테일러 C", brand: "뉴랩", countryId: "JP", retailerId: "retailer-c", brandId: "brand-new", type: "retail", combinationKey: "retail:JP:retailer-c:brand-new" } } });
const extraUsers = [
    ["user-admin", "GSG 관리자", "admin@example.test", "gsg", "active"],
    ["user-selected-admin", "지정 범위 관리자", "selected@example.test", "gsg", "active"],
    ["user-price", "가격 담당자", "price@example.test", "gsg", "active"],
    ["user-co", "공동 담당자", "co@example.test", "brand", "active"],
    ["user-team", "브랜드 팀원", "team@example.test", "brand", "active"],
    ["user-suspended", "중지 사용자", "suspended@example.test", "brand", "suspended"],
    ["user-invited", "초대 대기 사용자", "invited@example.test", "brand", "invited"],
    ["user-none", "소속 없는 사용자", "none@example.test", "brand", "active"],
] as const;
for (const [id, name, email, role, status] of extraUsers)
    fixtures.push({ kind: "user", input: { id, contextId: null, data: { name, email, normalizedEmail: email, role, status, authVersion: 1, adminGrant: id === "user-admin" ? { scope: "all", contextIds: [], internalPriceAccess: true } : id === "user-selected-admin" ? { scope: "selected", contextIds: ["ctx-jp-a-luna"], internalPriceAccess: false } : null } } });
for (const [userId, contextId, role, status, price] of [
    ["user-gsg", "ctx-jp-a-luna", "operator", "active", false],
    ["user-price", "ctx-jp-a-luna", "operator", "active", true],
    ["user-luna", "ctx-jp-a-luna", "brand", "active", false],
    ["user-luna", "ctx-jp-b-luna", "brand", "active", false],
    ["user-wave", "ctx-jp-a-wave", "brand", "active", false],
    ["user-co", "ctx-jp-a-luna", "brand", "active", false],
    ["user-team", "ctx-jp-a-luna", "brand", "active", false],
    ["user-suspended", "ctx-jp-a-luna", "brand", "suspended", false],
    ["user-invited", "ctx-jp-a-luna", "brand", "invited", false],
] as const)
    fixtures.push({ kind: "membership", input: { id: `member-${userId}-${contextId}`, contextId, data: { userId, role, status, internalPriceAccess: price, scope: "합성 담당 범위", activatedAt: status === "active" ? FIXTURE_TIME : null, suspendedAt: status === "suspended" ? FIXTURE_TIME : null } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-gsg", contextId: null, data: { userId: "user-gsg", scheme: "scrypt-v1", salt: "11a7d2b6a768a7270b3d8c03035702af", digest: "f75e0e9e92e2594408e29a75691db636430b94ff820cf030ad006ae2e13a6b8f3b082d1970cd6ff4dfa670160b875530f81032f0f9486c63c11ddd63960d23c8" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-luna", contextId: null, data: { userId: "user-luna", scheme: "scrypt-v1", salt: "1ad2c10ef5986c896b0cbc3fcee1c47c", digest: "922e3e7665855e55299f507bf58dafd9f621c88d78242a8eabc1e775fc213e58f8821386e52e72c793c965cbc4b01ce7305eaf6684bed39b7d1549fcecbe1490" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-wave", contextId: null, data: { userId: "user-wave", scheme: "scrypt-v1", salt: "9ab39dd8dc8850514453a6841ccb82f0", digest: "02f203777c2f528a74747e999dc6ce32e74328b65a5a11b763c02fe900457db811cdbc9d93dbd9015406731c5de67aabddba102e7da07a29b9ac16583ed1c344" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-admin", contextId: null, data: { userId: "user-admin", scheme: "scrypt-v1", salt: "658dc9499868d0e8ae1904b7173b24c1", digest: "fae7e6e4f9b1c914dab14edff1b00b8b6f0e2f2bc6acf498c89840e8b41f2031cb84f22844d3213d698694973e3191098fe10c3453cd59c6f9f4934dcb9b57e3" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-selected-admin", contextId: null, data: { userId: "user-selected-admin", scheme: "scrypt-v1", salt: "2deecf9ed71a74baf9e77bcc8b24c24d", digest: "b90199c13667c2064f2cedd412ef2c4ed87f9669a2ba2671361660bdb5ac22348884840d5bb1d1021190e6ec00a4d65c6cd1d3b18e09fa36310725a8e8362b33" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-price", contextId: null, data: { userId: "user-price", scheme: "scrypt-v1", salt: "261ee45bc4922e35ad10e9e56dc2d63c", digest: "14e22090ddc141771627f784f867bbd1b9bec363b9c6a58538c19e10d608a95a48060f82bf224ecf3310daf27ee4fba27a9e5d8eb80d5152400e266b364b2863" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-co", contextId: null, data: { userId: "user-co", scheme: "scrypt-v1", salt: "86a869d58f2c3c81406817cbc38bd35f", digest: "72aa8670726551209c510d70fb9f77f26dba978cb7149438f8bc4b3efe185de50f5bea7e4c73845cfd95fa007d33b0975432ae557849335378fe7c0e9d21edfe" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-team", contextId: null, data: { userId: "user-team", scheme: "scrypt-v1", salt: "699fae525f2922d048328b7b04c5ca25", digest: "da25da95eee80f11c5256aba9c537cf97844f399e437806a57d86ec2460e5825c10a3fd523f166e6826eb093a1e2be1450f5b189c3c7d5d3f8d43e1f3831cbb8" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-suspended", contextId: null, data: { userId: "user-suspended", scheme: "scrypt-v1", salt: "b54eecdba64f2eed52bf350ce8166b06", digest: "0ab95d58a237810b14b14c2f9e0a261119cc0e0f326ddde28a4c3f1e31af693d51c6afbc42aae4e6494eb49ecec9f3afa91aaccbe7b7122f14ccf9a88356bef4" } } });
fixtures.push({ kind: "credential", input: { id: "cred-user-none", contextId: null, data: { userId: "user-none", scheme: "scrypt-v1", salt: "58716d5b52f50b9b31bf1ab8bb624c0e", digest: "eefe7af524e063141271725ab919308b2dc16cff23ef117d3a57a1c83fdbbffa36f35f0a6d68fdfd180e8461635a0156e0c188a46ce73c863a8d27fe66ff593f" } } });
