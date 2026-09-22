import { parseAiConfig, type ServerConfig } from '@/server/config/parse';
import { PROVIDER_LIMITS, type ProviderIssue } from '@/domain/ai-provider/types';
export type ProviderConfig = { config: ServerConfig['openai'] | null; issue: ProviderIssue | null };
export function providerConfig(): ProviderConfig { try { const config = parseAiConfig(process.env); return { config, issue: !config.apiKey ? 'KEY_MISSING' : !config.model ? 'CONFIGURATION' : null }; } catch { return { config: null, issue: 'CONFIGURATION' }; } }
export const providerEngine = (modelId: string | undefined) => ({ engine: 'provider' as const, modelId: modelId ?? '미설정', promptVersion: 'gs-hale-provider-review/1', providerCalled: false as const, label: 'OpenAI · 허용된 읽은 범위 분석' });
export { PROVIDER_LIMITS };
