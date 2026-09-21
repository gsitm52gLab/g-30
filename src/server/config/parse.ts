// Pure parser: only explicitly supplied configuration is read here. No process.env access.
export interface ServerConfig { dataSource: "mock" | "sqlite"; databaseFile: string; openai: { apiKey?: string; model?: string; baseURL: string } }
export class ConfigurationError extends Error {
  constructor(public readonly field: string) { super(`환경 설정을 확인하세요: ${field}`); this.name = "ConfigurationError"; }
}
export function parseStorageConfig(source: Record<string, string | undefined>): Pick<ServerConfig, "dataSource" | "databaseFile"> {
  const dataSource = source.DATA_SOURCE?.trim() || "mock";
  if (dataSource !== "mock" && dataSource !== "sqlite") throw new ConfigurationError("DATA_SOURCE");
  const databaseFile = source.DATABASE_FILE?.trim() || ".local/data/gs-hale.db";
  if (databaseFile.includes("\0")) throw new ConfigurationError("DATABASE_FILE");
  return { dataSource, databaseFile };
}
export function parseAiConfig(source: Record<string, string | undefined>): ServerConfig["openai"] {
  const model = source.OPENAI_MODEL?.trim();
  const baseURL = source.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";
  try {
    const url = new URL(baseURL);
    if (url.protocol !== "https:" || url.hostname !== "api.openai.com" || url.username || url.password || url.search || url.hash || url.port || !/^\/v1\/?$/.test(url.pathname)) throw new Error();
  } catch { throw new ConfigurationError("OPENAI_BASE_URL"); }
  return { apiKey: source.OPENAI_API_KEY?.trim() || undefined, model: model === "gpt-6 astra" ? "gpt-6-astra" : model || undefined, baseURL };
}
export function parseConfig(source: Record<string, string | undefined>): ServerConfig { return { ...parseStorageConfig(source), openai: parseAiConfig(source) }; }
