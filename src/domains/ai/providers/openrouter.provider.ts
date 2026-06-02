import https from 'https';
import { URL } from 'url';
import { logger } from '../../../shared/utils/logger';
import { createDevHttpsAgent } from '../../../shared/utils/httpAgent';
import { AI_CONSTANTS } from '../ai.constants';
import {
  AIProvider,
  AIProviderError,
  ChatCompletionRequest,
  ChatCompletionResult,
} from './provider.types';

interface OpenRouterChoice {
  message?: { content?: string };
}

interface OpenRouterEnvelope {
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  error?: { message?: string; code?: number };
}

/**
 * OpenRouter chat-completions provider.
 *
 * Reliability: per-request timeout, retry-with-fallback-model on
 * timeout / 429 / 5xx / empty-or-invalid envelopes. Never logs the API key.
 */
export class OpenRouterProvider implements AIProvider {
  readonly name = 'openrouter';
  private readonly apiKey: string;
  private readonly primaryModel: string;
  private readonly fallbackModel: string;

  constructor() {
    this.apiKey = (process.env.OPENROUTER_API_KEY || '').trim();
    this.primaryModel = AI_CONSTANTS.primaryModel;
    this.fallbackModel = AI_CONSTANTS.fallbackModel;
    console.log('OpenRouterProvider constructor', this.apiKey, this.primaryModel, this.fallbackModel);
  }


  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    if (!this.isConfigured()) {
      throw new AIProviderError('OpenRouter API key not configured', false);
    }

    try {
      return await this.callModel(this.primaryModel, request, false);
    } catch (error) {
      console.log('OpenRouterProvider createChatCompletion error', error);
      const provErr =
        error instanceof AIProviderError
          ? error
          : new AIProviderError(error instanceof Error ? error.message : String(error), true);

      const canFallback = provErr.retryable && this.fallbackModel && this.fallbackModel !== this.primaryModel;
      if (!canFallback) {
        throw provErr;
      }

      logger.warn('[AI FALLBACK MODEL]', {
        provider: this.name,
        from: this.primaryModel,
        to: this.fallbackModel,
        reason: provErr.message,
        status: provErr.status,
      });

      return this.callModel(this.fallbackModel, request, true);
    }
  }

  private async callModel(
    model: string,
    request: ChatCompletionRequest,
    fallbackUsed: boolean
  ): Promise<ChatCompletionResult> {
    const start = Date.now();

    const payload: Record<string, unknown> = {
      model,
      messages: request.messages,
      temperature: request.temperature ?? AI_CONSTANTS.planTemperature,
      max_tokens: request.maxTokens ?? AI_CONSTANTS.planMaxTokens,
    };
    console.log('OpenRouterProvider callModel payload', payload);
    if (request.jsonMode) {
      payload.response_format = { type: 'json_object' };
    }

    const envelope = await this.postJson(JSON.stringify(payload));

    const content = envelope.choices?.[0]?.message?.content;
    console.log('OpenRouterProvider callModel content', content);
    if (!content || !content.trim()) {
      throw new AIProviderError('Empty response from provider', true);
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

  private postJson(body: string): Promise<OpenRouterEnvelope> {
    return new Promise((resolve, reject) => {
      const url = new URL(AI_CONSTANTS.endpoint);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Length': String(Buffer.byteLength(body)),
      };
      if (AI_CONSTANTS.siteUrl) headers['HTTP-Referer'] = AI_CONSTANTS.siteUrl;
      if (AI_CONSTANTS.appName) headers['X-Title'] = AI_CONSTANTS.appName;

      const req = https.request(
        {
          method: 'POST',
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || 443,
          path: url.pathname + url.search,
          headers,
          agent: createDevHttpsAgent(),
          timeout: AI_CONSTANTS.requestTimeoutMs,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const status = res.statusCode || 0;
            const text = Buffer.concat(chunks).toString('utf8');

            if (status === 429) {
              return reject(new AIProviderError('Provider rate limited (429)', true, 429));
            }
            if (status >= 500) {
              return reject(new AIProviderError(`Provider server error (${status})`, true, status));
            }
            if (status >= 400) {
              // 4xx (bad request, auth) — not retryable with another model.
              return reject(new AIProviderError(`Provider rejected request (${status})`, false, status));
            }

            try {
              resolve(JSON.parse(text) as OpenRouterEnvelope);
            } catch {
              reject(new AIProviderError('Invalid JSON envelope from provider', true, status));
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new AIProviderError('Provider request timed out', true));
      });

      req.on('error', (err: Error) => {
        if (err instanceof AIProviderError) return reject(err);
        reject(new AIProviderError(`Network error contacting provider: ${err.message}`, true));
      });

      req.write(body);
      req.end();
    });
  }
}
