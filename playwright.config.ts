import { defineConfig, devices } from "@playwright/test";
const port = Number(process.env.E2E_PORT || "4111");
export default defineConfig({
    testDir: "tests/e2e", fullyParallel: false, workers: 1, retries: 0,
    reporter: [["list"], ["json", { outputFile: process.env.E2E_REPORT || ".local/e2e-results.json" }]],
    outputDir: process.env.E2E_ARTIFACTS || "test-results",
    use: { baseURL: `http://127.0.0.1:${port}`, trace: "off", screenshot: "off", video: "off" },
    projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }],
    webServer: { command: "node --import tsx scripts/e2e-server.ts", url: `http://127.0.0.1:${port}/api/health`, reuseExistingServer: false, timeout: 60000 },
});
