import * as nextEnv from "@next/env";
// CLI entry points load only their own working directory; never search sibling projects.
export function loadProjectEnv() {
  const loader = nextEnv as typeof nextEnv & { default?: typeof nextEnv };
  const load = loader.loadEnvConfig ?? loader.default?.loadEnvConfig;
  if (!load) throw new Error("환경변수 로더를 찾을 수 없습니다.");
  load(process.cwd(), process.env.NODE_ENV !== "production", { info: () => undefined, error: () => undefined });
}
