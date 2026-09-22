import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { preflight } from "../../src/domain/ai-input/preflight";
import { INPUT_LIMITS } from "../../src/domain/ai-input/types";
import { contentHash, extractInput, snapshotHash } from "../../src/server/ai-input/extraction";
import { prepareExternalTransfer } from "../../src/server/ai-input/extraction/transfer";
const scope = { classification: "general_cosmetic", language: "ja", media: "pop", use: "synthetic review" };
const identity = (data: string | Uint8Array, id = "synthetic") => ({ sourceId: id, versionId: "v1", contextId: "context-a", sha256: contentHash(data) });
const textInput = (text: string) => ({ kind: "text", scope, source: identity(text), text });
const binary = (filename: string) => { const bytes = readFileSync(`tests/fixtures/ai-input/${filename}`); return { ...identity(bytes, filename), bytes, filename, mime: filename.endsWith(".pdf") ? "application/pdf" : "image/png" }; };
const pdf = (name = "native-12.pdf", selectedPages = [1]) => ({ kind: "pdf", scope, source: binary(name), selectedPages });
const image = (name = "japanese.png") => ({ kind: "images", scope, sources: [binary(name)] });
describe("AI input scope and admission (no provider)", () => {
    it("requires explicit supported scope; unknown, quasi-drug, medicated and other media/language do not analyze", () => {
        for (const classification of ["unknown", "quasi_drug", "medicated", ""])
            expect(preflight({ ...textInput("合成"), scope: { ...scope, classification } })).toMatchObject({ ok: false, status: "out_of_scope" });
        for (const change of [{ media: "website" }, { language: "ko" }])
            expect(preflight({ ...textInput("合成"), scope: { ...scope, ...change } })).toMatchObject({ ok: false, status: "out_of_scope" });
        expect(preflight({ ...textInput("合成"), scope: { ...scope, media: "leaflet" } }).ok).toBe(true);
    });
    it("counts Unicode code points, admits exactly 10k not bytes, refuses one over, empty and malformed UTF16", () => {
        expect(preflight(textInput("肌".repeat(10000))).ok).toBe(true);
        expect(preflight(textInput("😀".repeat(10000))).ok).toBe(true);
        expect(preflight(textInput("肌".repeat(10001)))).toMatchObject({ issue: "SIZE_LIMIT" });
        expect(preflight(textInput(" \n"))).toMatchObject({ issue: "EMPTY_INPUT" });
        expect(preflight(textInput("\ud800"))).toMatchObject({ issue: "INVALID_INPUT" });
    });
    it("admits 10MiB PDF and image aggregate exactly, rejects one byte over and fifth image", () => {
        const req = pdf(), exact = Buffer.alloc(INPUT_LIMITS.fileBytes, 32);
        exact.write("%PDF-1.7");
        expect(preflight({ ...req, source: { ...req.source, bytes: exact } }).ok).toBe(true);
        expect(preflight({ ...req, source: { ...req.source, bytes: Buffer.concat([exact, Buffer.from([32])]) } })).toMatchObject({ issue: "SIZE_LIMIT" });
        const img = image(), part = Buffer.alloc(INPUT_LIMITS.fileBytes / 4);
        img.sources[0].bytes.copy(part, 0, 0, 8);
        const sources = Array.from({ length: 4 }, (_, i) => ({ ...img.sources[0], sourceId: `image${i}`, bytes: part }));
        expect(preflight({ ...img, sources }).ok).toBe(true);
        expect(preflight({ ...img, sources: [...sources, { ...sources[0], sourceId: "fifth" }] })).toMatchObject({ issue: "IMAGE_LIMIT" });
        expect(preflight({ ...img, sources: sources.map((s, i) => i === 0 ? { ...s, bytes: Buffer.concat([part, Buffer.from([0])]) } : s) })).toMatchObject({ issue: "SIZE_LIMIT" });
    });
    it("rejects extension/MIME/signature mismatches, Illustrator, missing/duplicate/fractional/outsize selections", () => {
        const p = pdf();
        for (const source of [{ ...p.source, filename: "input.ai" }, { ...p.source, mime: "image/png" }, { ...p.source, bytes: binary("japanese.png").bytes }])
            expect(preflight({ ...p, source })).toMatchObject({ issue: "TYPE_MISMATCH" });
        for (const selectedPages of [[], [1, 1], [0], [1.5]])
            expect(preflight({ ...p, selectedPages })).toMatchObject({ issue: "INVALID_SELECTION" });
        expect(preflight({ ...p, selectedPages: Array.from({ length: 10 }, (_, i) => i + 1) }).ok).toBe(true);
        expect(preflight({ ...p, selectedPages: Array.from({ length: 11 }, (_, i) => i + 1) })).toMatchObject({ issue: "PAGE_LIMIT" });
        expect(preflight({ ...p, source: { ...p.source, bytes: Buffer.alloc(0) } })).toMatchObject({ issue: "EMPTY_INPUT" });
    });
});
describe("actual local extraction and immutable provenance", () => {
    it("maps text positions, freezes snapshots, strips extensions, detects content-version mismatch", async () => {
        const text = "肌😀\n合成", input = textInput(text), r = await extractInput({ ...input, scope: { ...scope, secret: { marker: 1 } }, source: { ...input.source, secret: "hidden" } });
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.snapshot.text).toBe(text);
        expect(r.snapshot.characterCount).toBe(5);
        expect(r.snapshot.segments[0].location.sourceTextEnd).toBe(text.length);
        expect(Object.isFrozen(r.snapshot.units)).toBe(true);
        expect(JSON.stringify(r)).not.toContain("secret");
        expect((await extractInput({ ...input, text: text + "changed" }))).toMatchObject({ ok: false, issue: "SOURCE_CHANGED" });
        const again = await extractInput(input);
        expect(again.ok && again.snapshot.snapshotHash).toBe(r.snapshot.snapshotHash);
    });
    it("actually reads only selected PDF native pages with precise page/box and excludes unselected sentinel", async () => {
        const r = await extractInput(pdf("native-12.pdf", [2, 10]));
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.snapshot.status).toBe("read");
        expect(r.snapshot.text).toContain("PAGE_02_SYNTHETIC");
        expect(r.snapshot.text).toContain("PAGE_10_SYNTHETIC");
        expect(r.snapshot.text).not.toContain("PAGE_01");
        expect(r.snapshot.text).toContain("うるおいを与える");
        expect(r.snapshot.units.filter(u => u.status === "unselected")).toHaveLength(10);
        expect(new Set(r.snapshot.segments.map(s => s.location.page))).toEqual(new Set([2, 10]));
        for (const s of r.snapshot.segments) {
            expect(s.location.box?.unit).toBe("pt");
            expect(s.confidence).toBeNull();
            expect(r.snapshot.text.slice(s.textStart, s.textEnd)).toBe(s.text);
        }
    }, 20000);
    it("actually admits ten selected pages, preserves copied byte/scope ownership and rejects changed hash", async () => {
        const input = pdf("native-12.pdf", Array.from({ length: 10 }, (_, i) => i + 1));
        const pending = extractInput(input);
        input.source.bytes.fill(0);
        input.selectedPages.length = 0;
        input.scope = { ...scope, media: "website" };
        const r = await pending;
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.snapshot.status).toBe("read");
        expect(r.snapshot.units.filter(u => u.status === "read")).toHaveLength(10);
        expect(r.snapshot.scope.media).toBe("pop");
        expect(r.snapshot.text).not.toContain("PAGE_11");
    }, 20000);
    it("actually reads mixed native/scanned selected pages with local Japanese OCR and unresolved full-image coverage", async () => {
        const r = await extractInput(pdf("mixed-3.pdf", [1, 2]));
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.snapshot.status).toBe("partial");
        expect(r.snapshot.text).toContain("SELECTED_NATIVE_PAGE_ONE");
        expect(r.snapshot.text).not.toContain("UNSELECTED_PRIVATE_SENTINEL");
        expect(r.snapshot.segments.some(s => s.method === "ocr" && s.location.page === 2 && s.text.includes("すこやか"))).toBe(true);
        expect(r.snapshot.issues).toContain("OCR_COVERAGE_UNKNOWN");
        expect(r.snapshot.engines.languageAssetSha256).toMatch(/^[a-f0-9]{64}$/);
        const ocr = r.snapshot.segments.find(s => s.method === "ocr")!;
        expect(ocr.location.box?.unit).toBe("pt");
        expect(ocr.confidence).toBeGreaterThanOrEqual(70);
        expect(r.snapshot.units.find(u => u.page === 3)?.status).toBe("unselected");
    }, 30000);
    it("actually recognizes image Japanese with pixel boxes, keeps image OCR partial", async () => {
        const r = await extractInput(image());
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        expect(r.snapshot.text).toContain("すこやか");
        expect(r.snapshot.issues).toContain("LOW_CONFIDENCE");
        expect(r.snapshot.units[0].unread.some(u => u.code === "LOW_CONFIDENCE" && u.confidence !== null && u.confidence < 70)).toBe(true);
        expect(r.snapshot.status).toBe("partial");
        expect(r.snapshot.segments.every(s => s.location.imageIndex === 0 && s.location.box?.unit === "px")).toBe(true);
        expect(r.snapshot.providerCalled).toBe(false);
    }, 20000);
    it("reports locked/corrupt PDFs, invalid actual page, blank PDF and corrupt/lowcontrast/blank images", async () => {
        for (const [input, code] of [[pdf("locked.pdf"), "PDF_LOCKED"], [pdf("corrupt.pdf"), "PDF_CORRUPT"], [pdf("native-12.pdf", [13]), "INVALID_SELECTION"], [pdf("blank.pdf"), "NO_TEXT"], [image("corrupt.png"), "IMAGE_CORRUPT"], [image("low-contrast.png"), "LOW_CONTRAST"], [image("blank.png"), "NO_TEXT"]] as const) {
            const r = await extractInput(input);
            expect(r.ok).toBe(true);
            if (r.ok) {
                expect(r.snapshot.status).toBe("unread");
                expect(r.snapshot.text).toBe("");
                expect(r.snapshot.issues).toContain(code);
                expect(r.snapshot.units.some(u => u.status === "read")).toBe(false);
            }
        }
    }, 30000);
    it("actually kills worker on lower time/memory budget, preserving explicit unread and no provider call", async () => {
        for (const [limits, issue] of [[{ timeoutMs: 1 }, "WORKER_TIMEOUT"], [{ rssMiB: 1 }, "WORKER_MEMORY"]] as const) {
            const r = await extractInput(pdf("mixed-3.pdf", [1, 2]), limits);
            expect(r.ok).toBe(true);
            if (r.ok) {
                expect(r.snapshot.issues).toContain(issue);
                expect(r.snapshot.units.filter(u => u.status === "unread")).toHaveLength(2);
                expect(r.snapshot.providerCalled).toBe(false);
            }
        }
    }, 10000);
    it("uses server-resolved current provenance/access, denies confidential and revoked/version mismatch; no client assertion", async () => {
        const r = await extractInput(textInput("合成テキスト"));
        expect(r.ok).toBe(true);
        if (!r.ok)
            return;
        const current = async (source: typeof r.snapshot.sources[number]) => ({ ...source, verifiedSnapshotHash: r.snapshot.snapshotHash, currentReadAllowed: true, externalUseAllowed: true, provenance: "synthetic" as const, checkedAt: new Date().toISOString() });
        expect(await prepareExternalTransfer(r.snapshot, current)).toMatchObject({ allowed: true, providerCalled: false });
        for (const change of [{ verifiedSnapshotHash: "unregistered-client-hash" }, { currentReadAllowed: false }, { versionId: "v2" }, { sha256: "0".repeat(64) }])
            expect(await prepareExternalTransfer(r.snapshot, async (s) => ({ ...await current(s), ...change }))).toMatchObject({ allowed: false, reason: "CURRENT_ACCESS_DENIED" });
        for (const provenance of ["confidential", "unknown"] as const)
            expect(await prepareExternalTransfer(r.snapshot, async (s) => ({ ...await current(s), provenance }))).toMatchObject({ allowed: false, reason: "EXTERNAL_USE_DENIED" });
        expect(await prepareExternalTransfer({ ...r.snapshot, text: "tampered" }, current)).toMatchObject({ allowed: false, reason: "SNAPSHOT_INVALID" });
        const { snapshotHash: hash, ...body } = r.snapshot;
        expect(snapshotHash(body)).toBe(hash);
        const expanded = { ...body, text: "肌".repeat(30000) }, oversize = { ...expanded, snapshotHash: snapshotHash(expanded) };
        expect(await prepareExternalTransfer(oversize, async (s) => ({ ...await current(s), verifiedSnapshotHash: oversize.snapshotHash }))).toMatchObject({ allowed: false, reason: "TOKEN_LIMIT" });
    });
});
