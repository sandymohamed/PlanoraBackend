/**
 * Provider abstraction for the hybrid AI layer.
 * Lets the service swap OpenRouter / OpenAI / others without touching routes.
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  /** 0.3–0.5 recommended for compact, deterministic JSON output */
  temperature?: number;
  /** Hard cap on output tokens (free-tier friendly) */
  maxTokens?: number;
  /** Request a strict JSON object back from the provider */
  jsonMode?: boolean;
}

export interface ChatCompletionUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
  provider: string;
  /** True when the fallback model answered after the primary failed */
  fallbackUsed: boolean;
  latencyMs: number;
  usage?: ChatCompletionUsage;
}

export interface AIProvider {
  readonly name: string;
  /** Whether the provider has the credentials it needs to make calls */
  isConfigured(): boolean;
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResult>;
}

/**
 * Typed provider error. `retryable` signals the caller may retry with a
 * fallback model (timeouts, 429, 5xx, empty/invalid envelopes).
 */
export class AIProviderError extends Error {
  public readonly retryable: boolean;
  public readonly status?: number;

  constructor(message: string, retryable: boolean, status?: number) {
    super(message);
    this.name = 'AIProviderError';
    this.retryable = retryable;
    this.status = status;
  }
}
