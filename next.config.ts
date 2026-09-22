import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/** Child entry points are not imported by Next. Trace their installed runtime graph explicitly. */
function workerPackages(names: string[]): string[] {
  const root = process.cwd();
  const seen = new Set<string>();
  function visit(name: string, parent: string, optional = false) {
    // Resolve manifests without package exports (sharp intentionally hides package.json).
    const directories = createRequire(parent).resolve.paths(`${name}/package.json`) ?? [];
    const manifest = directories.map(dir => path.join(dir, name, "package.json")).find(existsSync);
    if (!manifest) {
      if (optional) return; // Native optional dependencies vary with the build platform.
      throw new Error(`Missing worker runtime dependency: ${name}`);
    }
    const relative = path.relative(root, path.dirname(manifest));
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Worker dependency outside tracing root: ${name}`);
    if (seen.has(relative)) return;
    seen.add(relative);
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(pkg.dependencies ?? {})) {
      visit(dependency, manifest, dependency in (pkg.optionalDependencies ?? {}));
    }
    for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) visit(dependency, manifest, true);
  }
  for (const name of names) visit(name, path.join(root, "package.json"));
  return [...seen].sort().map(relative => `./${relative.split(path.sep).join("/")}/**/*`);
}

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "sharp"],
  // The production build uses Webpack so exclusions run after explicit includes.
  // Next 16.3.5 Turbopack includes can also select nested worktree copies.
  // Keep these explicit: partial-match negative extglobs also reject runtime files.
  outputFileTracingExcludes: {
    "/*": [
      "./**/.worktrees", "./**/.worktrees/**/*", "./**/.execution", "./**/.execution/**/*",
      "./**/.git", "./**/.git/**/*", "./**/.env", "./**/.env.*", "./**/*.env", "./**/*.log",
      "./.local/**/*", "./.data/**/*", "./artifacts/**/*", "./logs/**/*", "./sessions/**/*",
      "./docs/**/*", "./tests/**/*", "./scripts/**/*", "./coverage/**/*",
      "./test-results/**/*", "./playwright-report/**/*",
    ],
  },
  outputFileTracingIncludes: {
    "/*": ["./src/server/postgres/tls/supabase-prod-ca-2021.crt"],
    "/api/imports/source": [
      "./package.json", "./tsconfig.json",
      "./src/server/imports/parser-child.ts", "./src/server/imports/parser-core.ts",
      "./src/server/imports/zip.ts", "./src/server/imports/xml.ts", "./src/server/imports/xml-errors.ts",
      "./src/domain/imports/types.ts",
      ...workerPackages(["tsx", "exceljs", "jszip", "yauzl", "saxes"]),
    ],
    "/api/ai-input/**/*": [
      "./src/server/ai-input/extraction/worker.mjs",
      ...workerPackages(["pdfjs-dist", "tesseract.js", "@tesseract.js-data/jpn", "@napi-rs/canvas", "sharp"]),
    ],
  },
  turbopack: { root: process.cwd() },
};
export default config;
