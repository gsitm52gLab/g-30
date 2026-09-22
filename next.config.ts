import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3", "pdfjs-dist", "@napi-rs/canvas", "tesseract.js", "sharp"],
  outputFileTracingIncludes: { "/api/ai-input/**/*": ["./src/server/ai-input/extraction/worker.mjs", "./node_modules/pdfjs-dist/**/*", "./node_modules/tesseract.js/**/*", "./node_modules/tesseract.js-core/**/*", "./node_modules/@tesseract.js-data/jpn/**/*", "./node_modules/@napi-rs/**/*", "./node_modules/@img/**/*", "./node_modules/sharp/**/*"] },
  turbopack: { root: process.cwd() },
};
export default config;
