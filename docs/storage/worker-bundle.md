# Excel / OCR worker bundles

The Excel parser and AI extraction run in child processes. Importing the parent service does not make Next.js trace a string-named child entry point or its full dependency graph.

`next.config.ts` includes the Excel child and its TypeScript source graph for `/api/imports/source`, plus `tsx` and the installed runtime dependencies of ExcelJS/JSZip/yauzl/saxes. It also includes the AI worker, PDF.js, Tesseract, Japanese language data, canvas and sharp with their installed runtime dependencies. Resolution follows the actual package hierarchy, including nested overrides. Only runtime and installed optional dependencies are included; dependency development trees are not traversed. Missing required packages fail the build. Native optional packages follow the build platform, so build on the deployment platform.

The original route traces omitted the Excel child/tsx and sharp's `detect-libc` dependency. The repair changes packaging only: parser rules, exact decimals/leading zeros, formula rejection, XML/ZIP resource guards, selected-page processing, coverage warnings, byte/time/heap/RSS limits and child termination remain unchanged. `tsx` is a build dependency whose runtime files must remain in the resulting trace.

The first isolated-checkout proof did not cover a populated working root. Integration exposed nested worktree and private evidence files in the Excel trace. The copy guard rejected that trace before creating a bundle; it was not deployed. Rebuilding with a fresh cache reproduced the failure.

Production builds explicitly use `next build --webpack`. In Next 16.3.5, Turbopack collects explicit includes with partial glob matching, so `package.json`, `tsconfig.json` and worker dependency patterns also match copies inside nested worktrees. These includes are appended after graph exclusions. The Webpack trace collector instead applies exclusions after merging includes. The configuration keeps explicit private/worktree/Git/env/log exclusions; the probe independently enforces the runtime root allowlist. Broad negative extglobs are avoided because partial matching can also exclude required runtime files. Development retains its existing bundler, and no parser rule or dependency changes.

The exact-version implementation is documented in [Turbopack tracing](https://github.com/vercel/next.js/blob/v16.3.5/crates/next-api/src/nft.rs), [final NFT assembly](https://github.com/vercel/next.js/blob/v16.3.5/crates/next-api/src/nft_json.rs), and the [Webpack include/exclude collector](https://github.com/vercel/next.js/blob/v16.3.5/packages/next/src/build/collect-build-traces.ts). A successful build alone is insufficient: the all-NFT guard and isolated worker checks below remain required.

## Reproduce the isolated bundle check

Use Node 24 and the locked installation:

```sh
npm ci
npm run build
WORKER_BUNDLE_EVIDENCE=/absolute/private/evidence/path npx tsx scripts/verify-worker-bundle.ts
```

Use a new evidence path per run. The script copies only each built route NFT's declared files to separate temporary directories outside the repository. It preserves per-file hashes, total bytes, largest assets, invocation inputs/output, exit status and elapsed time. No dependency symlinks are copied, and it checks that there is no ancestor `node_modules`. Child environment variables are explicitly limited; no `.env`, database, Storage or provider connection is used.

Before creating either bundle, the script audits **all** built server NFT files, including the top-level Next server and minimal-server traces. It checks normalized lexical paths and resolved symlink targets against the same runtime boundary before reading any referenced contents. One denied or unresolved entry stops the run with zero copied files; the preflight report contains counts/reasons, not private paths or contents. `--audit-only` runs just this gate; `--check-trace /absolute/test.nft.json` supports isolated negative fixtures. Treat this preflight as a required release check, including in populated repositories. A successful build alone does not prove safe trace contents.

The populated-root regression uses only newly created synthetic worktree/private/local/data/log/session/env canaries, including a runtime-looking symlink to private synthetic data. Include nested `package.json`, `tsconfig.json`, `src/server/imports/parser-child.ts`, and `node_modules/exceljs` / `node_modules/tsx` paths: ordinary uniquely named JSON files do not reproduce the explicit-include collision. Original failed integration evidence remains separate. Do not copy real private files into a test bundle or weaken the preflight to make it pass.

The probe runs an exact-value workbook, a cached-formula rejection, corrupt XLSX, selected-page text PDF, actual Japanese image OCR and corrupt PDF. A negative probe verifies that Node denies reading the original repository. Node permission mode allows reads only under the copied directory (including its case-swapped alias used by TSX's filesystem probe) and writes only under an isolated temporary cache. Native addons/worker threads/child processes are needed by these libraries; this diagnostic permission setup is not a production security sandbox claim.

Current author evidence is macOS arm64 only. Linux native optional packages, Vercel function packaging/size limits and deployed child resource monitoring remain **NOT_RUN** until the actual deployment check. Copying macOS binaries to Linux is not supported. The runtime still fails closed if its RSS monitor cannot run; this change does not remove that guard. Future routes invoking either child, including Storage finalization, must receive the same tracing contract and their own isolated/deployed verification.

Detailed command/source bindings and original failures are retained in the private `SUPABASE/worker-bundle` evidence directory. A local bundle PASS is not application Storage or deployed OCR acceptance.
