import { GeneratedPlan } from '../../shared/types';

export type PlanGenerationSource = 'AI' | 'OFFLINE_TEMPLATE';
export type PlanGenerationProvider = 'openrouter' | 'none';
export type PlanGenerationStatus = 'SUCCESS' | 'FALLBACK_SUCCESS';

export interface PlanGenerationMetadata {
  source: PlanGenerationSource;
  provider: PlanGenerationProvider;
  model?: string;
  fallback: boolean;
  fallbackReason?: string;
  quotaConsumed: boolean;
  durationMs: number;
  cacheHit: boolean;
  status: PlanGenerationStatus;
}

export interface PlanGenerationResult {
  plan: GeneratedPlan;
  metadata: PlanGenerationMetadata;
}
