import { describe, expect, it } from "vitest";
import { addCounts, assertSelection, emptyCounts, exactFilePattern, reportCounts, selectedFiles, type Report } from "../../scripts/e2e-runner-selection";
const report = (): Report => ({ config: { rootDir: "/fixture/tests" }, stats: { expected: 2, unexpected: 1, skipped: 1, flaky: 0 }, suites: [
    { specs: [{ id: "first", file: "first.spec.ts", tests: [{ projectName: "desktop" }] }], suites: [{ specs: [{ id: "second", file: "first.spec.ts", tests: [{ projectName: "desktop" }] }] }] },
    { specs: [{ id: "third", file: "second.spec.ts", tests: [{ projectName: "desktop" }] }] },
] });
describe("isolated E2E discovery and accounting", () => {
    it("groups nested discovered tests by exact file and keeps all selected identities", () => {
        expect(selectedFiles(report(), "desktop")).toEqual([{ file: "/fixture/tests/first.spec.ts", identities: ["desktop:first", "desktop:second"] }, { file: "/fixture/tests/second.spec.ts", identities: ["desktop:third"] }]);
    });
    it("rejects omitted, broadened, duplicated or foreign-project selections", () => {
        const [first, second] = selectedFiles(report(), "desktop");
        expect(() => assertSelection(first, [first])).not.toThrow();
        for (const actual of [[], [first, second], [{ ...first, identities: first.identities.slice(1) }], [{ ...first, identities: [...first.identities, first.identities[0]] }]]) expect(() => assertSelection(first, actual)).toThrow("omitted or broadened");
        expect(() => selectedFiles(report(), "mobile")).toThrow("unselected project");
    });
    it("file matching cannot OR filters or interpret path regex metacharacters", () => {
        const pattern = exactFilePattern("/fixture/a+[x].spec.ts");
        expect(pattern.test("/fixture/a+[x].spec.ts")).toBe(true);
        expect(pattern.test("/fixture/aaaxZspecXts")).toBe(false);
        expect(pattern.test("/fixture/a+[x].spec.ts.other")).toBe(false);
        expect(() => exactFilePattern("relative.spec.ts")).toThrow();
    });
    it("aggregates pass/fail/skip/flaky honestly and refuses malformed reports", () => {
        const total = emptyCounts(); addCounts(total, reportCounts(report())); addCounts(total, reportCounts(report()));
        expect(total).toEqual({ unit: "test", pass: 4, fail: 2, skip: 2, flaky: 0 });
        expect(() => reportCounts({ ...report(), stats: { ...report().stats, expected: NaN } })).toThrow();
    });
});
