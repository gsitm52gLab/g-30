import path from "node:path";

export type Counts = { unit: "test"; pass: number; fail: number; skip: number; flaky: number };
export type Selection = { file: string; identities: string[] };
type ReportTest = { projectName: string };
type ReportSpec = { id: string; file: string; tests: ReportTest[] };
type ReportSuite = { specs?: ReportSpec[]; suites?: ReportSuite[] };
export type Report = ReportSuite & { config: { rootDir: string }; stats: { expected: number; unexpected: number; skipped: number; flaky: number }; errors?: unknown[] };
export const emptyCounts = (): Counts => ({ unit: "test", pass: 0, fail: 0, skip: 0, flaky: 0 });
export function addCounts(target: Counts, counts: Counts) {
    for (const key of ["pass", "fail", "skip", "flaky"] as const) target[key] += counts[key];
}
export function reportCounts(report: Report): Counts {
    if (!report.stats || ["expected", "unexpected", "skipped", "flaky"].some(k => !Number.isInteger(report.stats[k as keyof Report["stats"]]) || report.stats[k as keyof Report["stats"]] < 0))
        throw new Error("Playwright report has no valid test counts.");
    return { unit: "test", pass: report.stats.expected, fail: report.stats.unexpected, skip: report.stats.skipped, flaky: report.stats.flaky };
}
/** Read Playwright's actual selection; do not approximate its regex/line/grep semantics. */
export function selectedFiles(report: Report, project: string): Selection[] {
    if (!report.config?.rootDir || !Array.isArray(report.suites)) throw new Error("Invalid Playwright discovery report.");
    const files = new Map<string, string[]>();
    function visit(suite: ReportSuite) {
        for (const spec of suite.specs ?? []) {
            if (typeof spec.id !== "string" || typeof spec.file !== "string" || !Array.isArray(spec.tests)) throw new Error("Invalid discovered test identity.");
            for (const test of spec.tests) {
                if (test.projectName !== project) throw new Error("Discovery returned an unselected project.");
                const file = path.resolve(report.config.rootDir, spec.file), identities = files.get(file) ?? [];
                identities.push(`${project}:${spec.id}`); files.set(file, identities);
            }
        }
        for (const nested of suite.suites ?? []) visit(nested);
    }
    visit(report);
    return [...files].map(([file, identities]) => ({ file, identities: identities.sort() }));
}
export function assertSelection(expected: Selection, actual: Selection[]) {
    if (actual.length !== 1 || actual[0].file !== expected.file || JSON.stringify(actual[0].identities) !== JSON.stringify(expected.identities))
        throw new Error("Selected test identities changed: an isolated file run omitted or broadened the CLI selection.");
}
export function exactFilePattern(file: string): RegExp {
    if (!path.isAbsolute(file)) throw new Error("E2E_RUN_FILE must be an absolute discovered file path.");
    return new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}
