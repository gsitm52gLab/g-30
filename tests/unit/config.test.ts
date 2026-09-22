import { describe, expect, it } from "vitest";
import { parseConfig, parseStorageConfig } from "@/server/config/parse";
describe("server configuration", () => {
  it("runs mock without an API key", () => { const config = parseConfig({}); expect(config.dataSource).toBe("mock"); expect(config.openai.apiKey).toBeUndefined(); });
  it("keeps core storage available when optional AI configuration is invalid", () => { expect(parseStorageConfig({ DATA_SOURCE: "sqlite", OPENAI_BASE_URL: "invalid-ai-endpoint" }).dataSource).toBe("sqlite"); });
  it("requires an explicit mode on Vercel and accepts supabase without reading secrets", () => {
    expect(() => parseStorageConfig({VERCEL:'1'})).toThrow('DATA_SOURCE');
    expect(parseStorageConfig({VERCEL:'1',DATA_SOURCE:'supabase'}).dataSource).toBe('supabase');
    expect(parseStorageConfig({DATA_SOURCE:'supabase'}).dataSource).toBe('supabase');
  });
  it("normalizes only the designated model alias", () => { expect(parseConfig({ OPENAI_MODEL: " gpt-6 astra " }).openai.model).toBe("gpt-6-astra"); expect(parseConfig({ OPENAI_MODEL: "new-user-model" }).openai.model).toBe("new-user-model"); });
  it("does not expose invalid configuration values", () => { expect(() => parseConfig({ DATA_SOURCE: "SYNTHETIC_SECRET" })).toThrow("DATA_SOURCE"); try { parseConfig({ DATA_SOURCE: "SYNTHETIC_SECRET" }); } catch (error) { expect(String(error)).not.toContain("SYNTHETIC_SECRET"); } });
  it("rejects non-OpenAI hosts and URL credentials without disclosing values", () => {
    for (const value of ["https://example.test/v1", "http://api.openai.com/v1", "https://CANARY:secret@api.openai.com/v1", "https://api.openai.com/v1?token=secret"]) {
      try { parseConfig({ OPENAI_BASE_URL: value }); throw new Error("expected rejection"); } catch (error) { expect(String(error)).toContain("OPENAI_BASE_URL"); expect(String(error)).not.toContain(value); }
    }
  });
});
