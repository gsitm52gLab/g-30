# Excel / OCR worker bundles

The Excel parser and AI extraction run in child processes. Importing the parent service does not make Next.js trace a string-named child entry point or its full dependency graph.

`next.config.ts` includes the Excel child and its TypeScript source graph for `/api/imports/source`, plus `tsx` and the installed runtime dependencies of ExcelJS/JSZip/yauzl/saxes. It also includes the AI worker, PDF.js, Tesseract, Japanese language data, canvas and sharp with their installed runtime dependencies. Resolution follows the actual package hierarchy, including nested overrides. Only runtime and installed optional dependencies are included; dependency development trees are not traversed. Missing required packages fail the build. Native optional packages follow the build platform, so build on the deployment platform.

The original route traces omitted the Excel child/tsx and sharp's `detect-libc` dependency. The repair changes packaging only: parser rules, exact decimals/leading zeros, formula rejection, XML/ZIP resource guards, selected-page processing, coverage warnings, byte/time/heap/RSS limits and child termination remain unchanged. `tsx` is a build dependency whose runtime files must remain in the resulting trace.

The first isolated-checkout proof did not cover a populated working root. Integration exposed Next's conservative tracing of unrelated configuration/JSON paths, including worktrees and private evidence. The resulting bundle was not deployed. Global trace exclusions now restrict top-level output to `node_modules`, `.next`, `src`, `public` and four explicit configuration manifests, and reject private/worktree/Git/env/log paths even inside those roots. No parser rule was relaxed.

## Reproduce the isolated bundle check

Use Node 24 and the locked installation:

```sh
npm ci
npm run build
WORKER_BUNDLE_EVIDENCE=/absolute/private/evidence/path npx tsx scripts/verify-worker-bundle.ts
```

Use a new evidence path per run. The script copies only each built route NFT's declared files to separate temporary directories outside the repository. It preserves per-file hashes, total bytes, largest assets, invocation inputs/output, exit status and elapsed time. No dependency symlinks are copied, and it checks that there is no ancestor `node_modules`. Child environment variables are explicitly limited; no `.env`, database, Storage or provider connection is used.

Before creating either bundle, the script audits **all** built server NFT files. It checks normalized lexical paths and resolved symlink targets against the same runtime boundary before reading any referenced contents. One denied or unresolved entry stops the run with zero copied files; the preflight report contains counts/reasons, not private paths or contents. `--audit-only` runs just this gate; `--check-trace /absolute/test.nft.json` supports isolated negative fixtures. Treat this preflight as a required release check, including in populated repositories. A successful build alone does not prove safe trace contents.

The populated-root regression uses only newly created synthetic worktree/private/local/data/log/session/env canaries, including a runtime-looking symlink to private synthetic data. Original failed integration evidence remains separate. Do not copy real private files into a test bundle or weaken the preflight to make it pass.

The probe runs an exact-value workbook, a cached-formula rejection, corrupt XLSX, selected-page text PDF, actual Japanese image OCR and corrupt PDF. A negative probe verifies that Node denies reading the original repository. Node permission mode allows reads only under the copied directory (including its case-swapped alias used by TSX's filesystem probe) and writes only under an isolated temporary cache. Native addons/worker threads/child processes are needed by these libraries; this diagnostic permission setup is not a production security sandbox claim.

Current author evidence is macOS arm64 only. Linux native optional packages, Vercel function packaging/size limits and deployed child resource monitoring remain **NOT_RUN** until the actual deployment check. Copying macOS binaries to Linux is not supported. The runtime still fails closed if its RSS monitor cannot run; this change does not remove that guard. Future routes invoking either child, including Storage finalization, must receive the same tracing contract and their own isolated/deployed verification.

Detailed command/source bindings and original failures are retained in the private `SUPABASE/worker-bundle` evidence directory. A local bundle PASS is not application Storage or deployed OCR acceptance.
