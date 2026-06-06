"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAIProvider = getAIProvider;
exports.resetAIProvider = resetAIProvider;
const openrouter_provider_1 = require("./openrouter.provider");
let cachedProvider;
/**
 * Returns the configured AI provider, or null when no provider is usable
 * (e.g. missing API key). Callers must treat null as "offline only".
 *
 * Swap providers here to migrate to OpenAI/others without touching the service.
 */
function getAIProvider() {
    if (cachedProvider !== undefined) {
        return cachedProvider;
    }
    const provider = new openrouter_provider_1.OpenRouterProvider();
    cachedProvider = provider.isConfigured() ? provider : null;
    return cachedProvider;
}
/** Test helper — clears the memoized provider so env changes take effect. */
function resetAIProvider() {
    cachedProvider = undefined;
}
