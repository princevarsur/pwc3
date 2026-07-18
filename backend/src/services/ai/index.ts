import { AIProvider, FeedbackContext, FeedbackResult } from './types';
import { ScriptedProvider } from './scripted';
import { ClaudeProvider } from './claude';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { logger } from '../logger';
import { getAISettings } from '../ai-config';

export { FeedbackContext, FeedbackResult };

// Provider is resolved fresh on every call via getAISettings() (the same
// DB-backed source of truth used by scenario/inject/debrief generation),
// instead of once at process boot, so admin-panel provider changes take
// effect immediately without a container restart.

/** @deprecated No longer needed — provider resolution now happens per-request in resolveProvider(). Kept as a no-op so existing callers don't break. */
export function initAIProvider(): void {
  // no-op
}

async function resolveProvider(): Promise<AIProvider | null> {
  const cfg = await getAISettings();

  if (cfg.activeProvider === 'anthropic' && cfg.anthropic.apiKey) {
    return new ClaudeProvider();
  } else if (cfg.activeProvider === 'ollama') {
    return new OllamaProvider();
  } else if (cfg.activeProvider === 'openai' && cfg.openai.apiKey && cfg.openai.baseUrl) {
    return new OpenAIProvider();
  }
  return null;
}

export async function generateFeedback(
  ctx: FeedbackContext,
  scriptedFeedback: string
): Promise<FeedbackResult> {
  const scripted = new ScriptedProvider(scriptedFeedback);
  const primaryProvider = await resolveProvider();

  if (!primaryProvider) {
    return scripted.generateFeedback(ctx);
  }

  try {
    const available = await primaryProvider.isAvailable();
    if (!available) {
      logger.warn('Primary AI provider unavailable, falling back to scripted');
      return scripted.generateFeedback(ctx);
    }
    return await primaryProvider.generateFeedback(ctx);
  } catch (err) {
    logger.error('AI provider error, falling back to scripted', { error: err });
    return scripted.generateFeedback(ctx);
  }
}
