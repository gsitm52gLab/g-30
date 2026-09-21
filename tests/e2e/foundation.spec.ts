import { test, expect } from "@playwright/test";
test("brand and home to task to product navigation", async ({ page, request }, testInfo) => {
  const health = await request.get("/api/health"); expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ dataSource: process.env.E2E_DATA_SOURCE || "mock", authentication: "not_implemented", ai: "not_connected" });
  await page.goto("/"); await expect(page).toHaveTitle(/GS HALE/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("해외 헬스케어 진출의모든 일");
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: /업무/ }).click();
  await expect(page.getByRole("heading", { name: "업무", exact: true })).toBeVisible();
  await page.getByRole("link", { name: /신규 입점 상품 기본자료 준비/ }).click();
  await expect(page.getByRole("heading", { name: "신규 입점 상품 기본자료 준비" })).toBeVisible();
  await page.getByRole("link", { name: /루나 데일리 세럼/ }).click();
  await expect(page.getByRole("heading", { name: "루나 데일리 세럼" })).toBeVisible();
  await page.getByRole("link", { name: "← 상품 목록" }).click();
  await expect(page.getByRole("heading", { name: "상품정보", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test("different contexts and empty results are not fabricated", async ({ page }) => {
  await page.goto("/tasks");
  await page.getByLabel("컨텍스트 선택").selectOption("ctx-jp-a-wave"); await page.getByRole("button", { name: "전환" }).click();
  await expect(page.getByRole("link", { name: /샘플 패키지 자료 확인/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /신규 입점 상품/ })).toHaveCount(0);
  await page.getByLabel("컨텍스트 선택").selectOption("ctx-sg-a-luna"); await page.getByRole("button", { name: "전환" }).click();
  await expect(page.getByRole("heading", { name: "아직 등록된 업무가 없습니다" })).toBeVisible();
  await page.goto("/products?context=ctx-sg-a-luna"); await expect(page.getByRole("heading", { name: "아직 등록된 상품이 없습니다" })).toBeVisible();
});
test("not-found and keyboard navigation remain usable", async ({ page }) => {
  await page.goto("/products/missing"); await expect(page.getByRole("heading", { name: "자료를 찾을 수 없습니다" })).toBeVisible();
  await page.goto("/"); await page.keyboard.press("Tab"); await expect(page.getByRole("link", { name: "본문으로 이동" })).toBeFocused();
  await page.keyboard.press("Enter"); await expect(page.locator("#main-content")).toBeFocused();
});
