import { spawn, execFile } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import path from "node:path";
import { INPUT_LIMITS, type Box, type IssueCode, type ReadUnit, type ExtractionSnapshot } from "../../../domain/ai-input/types";
export type WorkerUnit = Pick<ReadUnit, "page" | "imageIndex" | "status" | "coverage"> & { segments: { text: string; method: "pdf_text" | "ocr"; confidence: number | null; box: Box }[]; unread: { code: IssueCode; box: Box | null; confidence: number | null }[] };
export type WorkerResult = { units: WorkerUnit[]; pageCount: number | null; issue: IssueCode | null; engines: ExtractionSnapshot["engines"] | null };
/** Lower-only limits support deterministic resource-failure tests; callers cannot increase ceilings. */
export type ResourceLimits = { timeoutMs?: number; rssMiB?: number };
export async function runLocalWorker(job: object, limits: ResourceLimits = {}): Promise<WorkerResult> {
  const lower = (v: number | undefined, max: number) => v === undefined ? max : Number.isFinite(v) && v >= 1 ? Math.min(Math.floor(v), max) : 1;
  const timeout = lower(limits.timeoutMs, INPUT_LIMITS.workerMs), memory = lower(limits.rssMiB, INPUT_LIMITS.rssMiB);
  const result: WorkerResult = { units: [], pageCount: null, issue: null, engines: null };
  if (!new Set(["darwin", "linux"]).has(process.platform)) return { ...result, issue: "WORKER_UNAVAILABLE" };
  return new Promise(resolve => {
    const child = spawn(process.execPath, [`--max-old-space-size=${INPUT_LIMITS.heapMiB}`, path.resolve("src/server/ai-input/extraction/worker.mjs")], {
      env: { NODE_ENV: "production", PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "ja_JP.UTF-8", TZ: "UTC" }, stdio: ["pipe", "pipe", "pipe"],
    });
    const decoder = new StringDecoder("utf8");
    let pending = "", bytes = 0, done = false, closed = false, polling = false;
    const stop = (code: IssueCode) => { result.issue ??= code; child.kill("SIGKILL"); };
    const timer = setTimeout(() => stop("WORKER_TIMEOUT"), timeout);
    // V8 heap ceiling alone does not bound native raster/WASM allocations. Observe process RSS too.
    const monitor = setInterval(() => {
      if (polling || !child.pid || closed) return;
      polling = true;
      execFile("/bin/ps", ["-o", "rss=", "-p", String(child.pid)], { timeout: 1000 }, (error, output) => {
        polling = false;
        if (closed) return;
        if (error) { stop("WORKER_UNAVAILABLE"); return; }
        const rss = Number(output.trim());
        if (!Number.isFinite(rss)) stop("WORKER_UNAVAILABLE");
        else if (rss > memory * 1024) stop("WORKER_MEMORY");
      });
    }, 100);
    child.stdout.on("data", chunk => {
      bytes += chunk.length;
      if (bytes > INPUT_LIMITS.outputBytes) { stop("SIZE_LIMIT"); return; }
      pending += decoder.write(chunk);
      for (let nl = pending.indexOf("\n"); nl >= 0; nl = pending.indexOf("\n")) {
        const line = pending.slice(0, nl); pending = pending.slice(nl + 1);
        try {
          const item = JSON.parse(line);
          if (item.type === "metadata") result.pageCount = item.pageCount;
          else if (item.type === "unit") result.units.push(item.unit);
          else if (item.type === "fatal") { result.issue = item.code; result.engines = item.engines; done = true; }
          else if (item.type === "done") { result.engines = item.engines; done = true; }
          else stop("WORKER_FAILED");
        } catch { stop("WORKER_FAILED"); }
      }
    });
    // Never forward parser diagnostics or original contents to logs/API errors.
    child.stderr.on("data", chunk => { bytes += chunk.length; if (bytes > INPUT_LIMITS.outputBytes) stop("SIZE_LIMIT"); });
    child.stdin.on("error", () => {});
    child.on("error", () => { result.issue = "WORKER_UNAVAILABLE"; });
    child.on("close", code => {
      closed = true; clearTimeout(timer); clearInterval(monitor);
      if ((!done || code !== 0) && !result.issue) result.issue = "WORKER_FAILED";
      resolve(result);
    });
    child.stdin.end(JSON.stringify(job));
  });
}
