import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@": path.resolve("src"), "server-only": path.resolve("tests/server-only-shim.ts") } },
  test: { include: ["tests/unit/**/*.test.ts"], environment: "node" },
});
