import { AIProvider } from './provider.types';
import { OpenRouterProvider } from './openrouter.provider';

let cachedProvider: AIProvider | null | undefined;

/**
 * Returns the configured AI provider, or null when no provider is usable
 * (e.g. missing API key). Callers must treat null as "offline only".
 *
 * Swap providers here to migrate to OpenAI/others without touching the service.
 */
export function getAIProvider(): AIProvider | null {
  if (cachedProvider !== undefined) {
    return cachedProvider;
  }

  const provider = new OpenRouterProvider();
  cachedProvider = provider.isConfigured() ? provider : null;
  return cachedProvider;
}

/** Test helper — clears the memoized provider so env changes take effect. */
export function resetAIProvider(): void {
  cachedProvider = undefined;
}
