/**
 * PostHog (optional). Install when npm SSL works:
 *   npm install posthog-node
 */
import { env } from '../../config/env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

export function getPostHog(): unknown {
  if (!env.posthog.apiKey) return null;
  if (!client) {
    try {
      const { PostHog } = require('posthog-node');
      client = new PostHog(env.posthog.apiKey, { host: env.posthog.host });
    } catch {
      console.warn('[Planora] posthog-node not installed — analytics disabled');
    }
  }
  return client;
}

export function trackServerEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>
): void {
  const ph = getPostHog() as { capture?: (args: unknown) => void } | null;
  ph?.capture?.({ distinctId, event, properties });
}

export async function shutdownPostHog(): Promise<void> {
  await client?.shutdown?.();
}
