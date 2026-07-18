import { AIProvider, FeedbackContext, FeedbackResult } from './types';
import { logger } from '../logger';
import { getTemplateContent } from '../prompt-templates';
import { getAISettings } from '../ai-config';

export class OpenAIProvider implements AIProvider {
  async generateFeedback(ctx: FeedbackContext): Promise<FeedbackResult> {
    const cfg = await getAISettings();
    const { baseUrl, apiKey, model, maxTokens, temperature } = cfg.openai;
    const systemPrompt = await getTemplateContent('feedback_system');
    const prompt = buildFeedbackPrompt(ctx);

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: maxTokens,
        temperature,
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`OpenAI request failed: ${response.status} ${body.slice(0, 200)}`);
    }

    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const feedback = data.choices?.[0]?.message?.content?.trim() ?? '';
    return { feedback, provider: `openai:${model}` };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const cfg = await getAISettings();
      const { baseUrl, apiKey } = cfg.openai;
      if (!baseUrl || !apiKey) return false;
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(3000),
      });
      return res.ok;
    } catch (err) {
      logger.debug('OpenAI-compatible provider unavailable', { error: err });
      return false;
    }
  }

  providerName(): string {
    return 'openai';
  }
}

function buildFeedbackPrompt(ctx: FeedbackContext): string {
  const qualityLabel = ctx.isOptimal ? 'optimal' : ctx.scoreWeight >= 60 ? 'acceptable' : ctx.scoreWeight >= 30 ? 'suboptimal' : 'poor';

  return `Scenario: "${ctx.scenarioTitle}" (${ctx.scenarioType})
Phase: ${ctx.phase}
Incident Situation: ${ctx.injectNarrative}
Player Role: ${ctx.playerRole}
Decision Made: "${ctx.chosenOption}"
Decision Quality: ${qualityLabel} (score: ${ctx.scoreWeight}/100)
${ctx.mitreAttackId ? `MITRE ATT&CK: ${ctx.mitreAttackId} - ${ctx.mitreAttackName}` : ''}
${ctx.nistCsfFunction ? `NIST CSF Function: ${ctx.nistCsfFunction}` : ''}
${!ctx.isOptimal ? `The optimal choice was: "${ctx.optimalOptionText}"` : ''}

Provide constructive coaching feedback for this decision. Reference relevant frameworks and explain the real-world implications.`;
}
