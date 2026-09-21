import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: { root: process.cwd() },
};
export default config;
