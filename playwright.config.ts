import { defineConfig, devices } from "@playwright/test";
import { exactFilePattern } from "./scripts/e2e-runner-selection";
const port = Number(process.env.E2E_PORT || "4111");
if (!["desktop", "mobile"].includes(process.env.E2E_RUN_PROJECT || ""))
    throw new Error("Run E2E through npm run test:e2e (or test:e2e:db) for a fresh server and DB per project.");
export default defineConfig({
    testMatch: process.env.E2E_RUN_FILE ? exactFilePattern(process.env.E2E_RUN_FILE) : undefined,
    testDir: "tests/e2e", fullyParallel: false, workers: 1, retries: 0,
    reporter: [["list"], ["json", { outputFile: process.env.E2E_REPORT || ".local/e2e-results.json" }]],
    outputDir: process.env.E2E_ARTIFACTS || "test-results",
    use: { baseURL: `http://127.0.0.1:${port}`, trace: "off", screenshot: "off", video: "off" },
    projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } }],
});
