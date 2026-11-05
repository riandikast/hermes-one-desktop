import { officialProvider } from "../shared/official-providers";

export const PROVIDERS_WITHOUT_API_KEYS = new Set([
  "custom",
  "lmstudio",
  "ollama",
  "vllm",
  "llamacpp",
  "openai-codex",
]);

export function providerDoesNotNeedApiKey(provider: string): boolean {
  const auth = officialProvider(provider)?.auth;
  return PROVIDERS_WITHOUT_API_KEYS.has(provider) || !!(auth && auth !== "api_key");
}
