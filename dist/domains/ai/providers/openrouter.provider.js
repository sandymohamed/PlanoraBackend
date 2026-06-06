"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterProvider = void 0;
const https_1 = __importDefault(require("https"));
const url_1 = require("url");
const logger_1 = require("../../../shared/utils/logger");
const httpAgent_1 = require("../../../shared/utils/httpAgent");
const ai_constants_1 = require("../ai.constants");
const provider_types_1 = require("./provider.types");
/**
 * OpenRouter chat-completions provider.
 *
 * Reliability: per-request timeout, retry-with-fallback-model on
 * timeout / 429 / 5xx / empty-or-invalid envelopes. Never logs the API key.
 */
class OpenRouterProvider {
    constructor() {
        this.name = 'openrouter';
        this.apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
        this.primaryModel = ai_constants_1.AI_CONSTANTS.primaryModel;
        this.fallbackModel = ai_constants_1.AI_CONSTANTS.fallbackModel;
    }
    isConfigured() {
        return this.apiKey.length > 0;
    }
    async createChatCompletion(request) {
        if (!this.isConfigured()) {
            throw new provider_types_1.AIProviderError('OpenRouter API key not configured', false);
        }
        try {
            return await this.callModel(this.primaryModel, request, false);
        }
        catch (error) {
            console.log('OpenRouterProvider createChatCompletion error', error);
            const provErr = error instanceof provider_types_1.AIProviderError
                ? error
                : new provider_types_1.AIProviderError(error instanceof Error ? error.message : String(error), true);
            const canFallback = provErr.retryable && this.fallbackModel && this.fallbackModel !== this.primaryModel;
            if (!canFallback) {
                throw provErr;
            }
            logger_1.logger.warn('[AI FALLBACK MODEL]', {
                provider: this.name,
                from: this.primaryModel,
                to: this.fallbackModel,
                reason: provErr.message,
                status: provErr.status,
            });
            return this.callModel(this.fallbackModel, request, true);
        }
    }
    async callModel(model, request, fallbackUsed) {
        const start = Date.now();
        const payload = {
            model,
            messages: request.messages,
            temperature: request.temperature ?? ai_constants_1.AI_CONSTANTS.planTemperature,
            max_tokens: request.maxTokens ?? ai_constants_1.AI_CONSTANTS.planMaxTokens,
        };
        console.log('OpenRouterProvider callModel payload', payload);
        if (request.jsonMode) {
            payload.response_format = { type: 'json_object' };
        }
        const envelope = await this.postJson(JSON.stringify(payload));
        const content = envelope.choices?.[0]?.message?.content;
        console.log('OpenRouterProvider callModel content', content);
        if (!content || !content.trim()) {
            throw new provider_types_1.AIProviderError('Empty response from provider', true);
        }
        return {
            content,
            model,
            provider: this.name,
            fallbackUsed,
            latencyMs: Date.now() - start,
            usage: envelope.usage
                ? {
                    promptTokens: envelope.usage.prompt_tokens,
                    completionTokens: envelope.usage.completion_tokens,
                    totalTokens: envelope.usage.total_tokens,
                }
                : undefined,
        };
    }
    postJson(body) {
        return new Promise((resolve, reject) => {
            const url = new url_1.URL(ai_constants_1.AI_CONSTANTS.endpoint);
            const headers = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
                'Content-Length': String(Buffer.byteLength(body)),
            };
            if (ai_constants_1.AI_CONSTANTS.siteUrl)
                headers['HTTP-Referer'] = ai_constants_1.AI_CONSTANTS.siteUrl;
            if (ai_constants_1.AI_CONSTANTS.appName)
                headers['X-Title'] = ai_constants_1.AI_CONSTANTS.appName;
            const req = https_1.default.request({
                method: 'POST',
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname + url.search,
                headers,
                agent: (0, httpAgent_1.createDevHttpsAgent)(),
                timeout: ai_constants_1.AI_CONSTANTS.requestTimeoutMs,
            }, (res) => {
                const chunks = [];
                res.on('data', (c) => chunks.push(c));
                res.on('end', () => {
                    const status = res.statusCode || 0;
                    const text = Buffer.concat(chunks).toString('utf8');
                    if (status === 429) {
                        return reject(new provider_types_1.AIProviderError('Provider rate limited (429)', true, 429));
                    }
                    if (status >= 500) {
                        return reject(new provider_types_1.AIProviderError(`Provider server error (${status})`, true, status));
                    }
                    if (status >= 400) {
                        // 4xx (bad request, auth) — not retryable with another model.
                        return reject(new provider_types_1.AIProviderError(`Provider rejected request (${status})`, false, status));
                    }
                    try {
                        resolve(JSON.parse(text));
                    }
                    catch {
                        reject(new provider_types_1.AIProviderError('Invalid JSON envelope from provider', true, status));
                    }
                });
            });
            req.on('timeout', () => {
                req.destroy(new provider_types_1.AIProviderError('Provider request timed out', true));
            });
            req.on('error', (err) => {
                if (err instanceof provider_types_1.AIProviderError)
                    return reject(err);
                reject(new provider_types_1.AIProviderError(`Network error contacting provider: ${err.message}`, true));
            });
            req.write(body);
            req.end();
        });
    }
}
exports.OpenRouterProvider = OpenRouterProvider;
