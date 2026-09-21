import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { DEMO_PASSWORD } from "@/domain/catalog";

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("이메일", { exact: true }).fill(email);
    await page.getByLabel("비밀번호", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
}
async function mutate(request: APIRequestContext, url: string, method: string, data: unknown) {
    const csrf = await (await request.get("/api/auth/csrf")).json();
    return request.fetch(url, { method, data, headers: { Origin: `http://127.0.0.1:${process.env.E2E_PORT || "4111"}`, "X-CSRF-Token": csrf.csrfToken } });
}

test("policy: non-assigned team reads public tasks but cannot administer or see another context", async ({ page }, info) => {
    await login(page, "team@example.test");
    await page.goto("/tasks/task-onboarding?context=ctx-jp-a-luna");
    await expect(page.getByRole("heading", { name: "신규 입점 상품 기본자료 준비" })).toBeVisible();
    await expect(page.getByText("요청 3개 중 2개 제출 상태의 합성 예시")).toBeVisible();
    await page.screenshot({ path: info.outputPath("team-public-task.png"), fullPage: true });
    const manage = await page.request.get("/api/contexts/ctx-jp-a-luna/members");
    expect(manage.status()).toBe(403);
    const foreign = await page.request.get("/api/contexts/ctx-jp-a-wave/members");
    const missing = await page.request.get("/api/contexts/missing-context/members");
    expect(foreign.status()).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
    await page.goto("/tasks/task-wave?context=ctx-jp-a-wave");
    await expect(page.getByRole("heading", { name: "자료를 찾을 수 없습니다" })).toBeVisible();
    expect(await page.content()).not.toContain("샘플 패키지 자료 확인");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("policy: an existing browser session loses one membership immediately; its other context survives", async ({ browser, page }) => {
    await login(page, "admin@example.test");
    const brandContext = await browser.newContext();
    const brand = await brandContext.newPage();
    await login(brand, "luna@example.test");
    const members = await (await page.request.get("/api/contexts/ctx-jp-a-luna/members")).json();
    const member = members.members.find((m: { data: { userId: string } }) => m.data.userId === "user-luna");
    try {
        expect((await mutate(page.request, `/api/contexts/ctx-jp-a-luna/members/${member.id}`, "PATCH", { expectedRevision: member.revision, status: "suspended" })).status()).toBe(200);
        await brand.goto("/tasks/task-onboarding?context=ctx-jp-a-luna");
        await expect(brand.getByRole("heading", { name: "자료를 찾을 수 없습니다" })).toBeVisible();
        await brand.goto("/products/product-cream?context=ctx-jp-b-luna");
        await expect(brand.getByRole("heading", { name: "루나 모이스처 크림" })).toBeVisible();
    } finally {
        const latest = await (await page.request.get("/api/contexts/ctx-jp-a-luna/members")).json();
        const current = latest.members.find((m: { id: string }) => m.id === member.id);
        expect((await mutate(page.request, `/api/contexts/ctx-jp-a-luna/members/${member.id}`, "PATCH", { expectedRevision: current.revision, status: "active" })).status()).toBe(200);
        await brandContext.close();
    }
});

test("policy: logout and a different account cannot reuse cached context or choose a role", async ({ page }) => {
    await login(page, "admin@example.test");
    expect((await page.request.get("/api/auth/me")).headers()["cache-control"]).toContain("no-store");
    await page.goto("/contexts");
    await expect(page.getByRole("heading", { name: "컨텍스트 생성", exact: true })).toBeVisible();
    expect((await mutate(page.request, "/api/auth/logout", "POST", {})).status()).toBe(200);
    await login(page, "team@example.test");
    await page.goto("/contexts");
    await expect(page.getByRole("heading", { name: "컨텍스트 생성", exact: true })).toHaveCount(0);
    const response = await mutate(page.request, "/api/contexts", "POST", { type: "event", countryId: "JP", brandId: "brand-luna", eventName: "forged", role: "admin" });
    expect(response.status()).toBe(422);
    const me = await (await page.request.get("/api/auth/me")).json();
    expect(me.user.role).toBe("brand");
    expect(me.user.adminGrant).toBeNull();
    expect(me.contexts).toHaveLength(1);
});

test("policy: untrusted returnTo and script-like names stay within the app as text", async ({ page }) => {
    await page.goto("/login?returnTo=https://foreign.example");
    await page.getByLabel("이메일", { exact: true }).fill("admin@example.test");
    await page.getByLabel("비밀번호", { exact: true }).fill(DEMO_PASSWORD);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    const name = `<script>window.G02_XSS=true</script> ${Date.now()}`;
    const created = await mutate(page.request, "/api/contexts", "POST", { type: "event", countryId: "JP", brandId: "brand-luna", eventName: name });
    expect(created.status()).toBe(201);
    const context = await created.json();
    await page.goto(`/?context=${context.id}`);
    await expect(page.getByRole("region", { name: "현재 컨텍스트", exact: true })).toContainText(name);
    expect(await page.evaluate(() => "G02_XSS" in window)).toBe(false);
});
