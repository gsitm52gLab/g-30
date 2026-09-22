import * as nextEnv from "@next/env";
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
// CLI entry points load only their own working directory; never search sibling projects.
export function loadProjectEnv() {
  if (process.env.GS_HALE_ENV_FILE) {
    const values = parseEnv(readFileSync(process.env.GS_HALE_ENV_FILE, 'utf8'));
    for (const [key, value] of Object.entries(values)) if (process.env[key] === undefined) process.env[key] = value;
    return;
  }
  const loader = nextEnv as typeof nextEnv & { default?: typeof nextEnv };
  const load = loader.loadEnvConfig ?? loader.default?.loadEnvConfig;
  if (!load) throw new Error("환경변수 로더를 찾을 수 없습니다.");
  load(process.cwd(), process.env.NODE_ENV !== "production", { info: () => undefined, error: () => undefined });
}
