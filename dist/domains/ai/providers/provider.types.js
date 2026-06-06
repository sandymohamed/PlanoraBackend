"use strict";
/**
 * Provider abstraction for the hybrid AI layer.
 * Lets the service swap OpenRouter / OpenAI / others without touching routes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIProviderError = void 0;
/**
 * Typed provider error. `retryable` signals the caller may retry with a
 * fallback model (timeouts, 429, 5xx, empty/invalid envelopes).
 */
class AIProviderError extends Error {
    constructor(message, retryable, status) {
        super(message);
        this.name = 'AIProviderError';
        this.retryable = retryable;
        this.status = status;
    }
}
exports.AIProviderError = AIProviderError;
