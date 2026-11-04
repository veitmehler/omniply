import Anthropic from '@anthropic-ai/sdk'
import { getSystemApiKey } from '../../lib/system-keys'
import { calculateCost } from './cost-table'
import type { LLMAdapter, LLMCallOptions, LLMResponse } from './adapter'
import { LLMError } from './adapter'
import { instrumentCall } from '../../lib/net/instrument'
import { SONNET_45, resolveAnthropicModel, supportsTemperature, thinkingConfigFor, thinkingOffTypeFor } from './anthropic-models'

const DEFAULT_MODEL = SONNET_45

// The SDK's own default is 10 minutes with 2 built-in retries (retried
// automatically on timeout/429/5xx) — far too long to hold a worker slot for
// a text call. But 120s proved too tight: the writer/adjust steps run at
// maxTokens 16384, and a long article at degraded provider throughput
// legitimately exceeds 2 minutes — the old cap (× the SDK's 2 retries = the
// observed 361s failures) killed step 9 on both the 2026-07-10 prod E2E and
// the 2026-07-11 staging E2E while small calls returned in ~1s. 5 min with a
// single SDK retry bounds one step-runner attempt at 10 min while giving
// long completions room. Env-tunable for incident response.
const ANTHROPIC_TIMEOUT_MS = Number(process.env.ANTHROPIC_TIMEOUT_MS ?? 300_000)
const ANTHROPIC_SDK_MAX_RETRIES = 1

function parseAnthropicError(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes('529') || lower.includes('overloaded')) {
    return new LLMError(msg, { quotaType: 'overloaded', retryAfterSeconds: 30 })
  }

  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) {
    // Try to read retry-after from the error if Anthropic SDK embeds it
    const retryMatch = msg.match(/retry.?after[:\s]+(\d+)/i)
    return new LLMError(msg, {
      quotaType: 'rate_limit',
      retryAfterSeconds: retryMatch ? parseInt(retryMatch[1], 10) : 60,
    })
  }

  return new LLMError(msg, { quotaType: 'unknown' })
}

export class AnthropicAdapter implements LLMAdapter {
  getProvider() { return 'anthropic' }

  supportsModel(model: string) {
    return model.startsWith('claude')
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const apiKey = await getSystemApiKey('anthropic')
    if (!apiKey) throw new LLMError('No API key configured for provider: anthropic')

    const model = resolveAnthropicModel(options.model || DEFAULT_MODEL)
    const temperature = options.temperature ?? 0.7
    const maxTokens = options.maxTokens ?? 8192

    try {
      const client = new Anthropic({ apiKey, timeout: ANTHROPIC_TIMEOUT_MS, maxRetries: ANTHROPIC_SDK_MAX_RETRIES })
      const call = (thinking: { type: string } | null) =>
        instrumentCall({ provider: 'anthropic', op: `messages.create:${model}` }, () =>
          client.messages.create({
            model,
            max_tokens: maxTokens,
            ...(supportsTemperature(model) ? { temperature } : {}),
            ...(thinking ? { thinking: thinking as never } : {}),
            ...(options.systemPrompt ? { system: options.systemPrompt } : {}),
            messages: [{ role: 'user', content: options.userPrompt }],
          }),
        )

      const thinkingCfg = thinkingConfigFor(model, maxTokens)
      let response: Anthropic.Message
      try {
        response = await call(thinkingCfg)
      } catch (err) {
        // Thinking-type vocabulary varies per model family and release; a 400
        // naming the thinking param must never take a surface down — fall back
        // to the model's default thinking behavior.
        const msg = err instanceof Error ? err.message : String(err)
        if (thinkingCfg && msg.includes('thinking')) response = await call(null)
        else throw err
      }
      let textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      if (!textBlock?.text?.trim() && thinkingCfg?.type === 'adaptive') {
        // Thinking consumed the whole window and no text came back — retry
        // once with thinking off rather than failing the step.
        response = await call({ type: thinkingOffTypeFor(model) })
        textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
      }
      const text = textBlock?.text ?? ''
      if (!text.trim()) throw new LLMError('Anthropic returned empty response')

      const inputTokens = response.usage.input_tokens
      const outputTokens = response.usage.output_tokens

      const rawFinish = response.stop_reason
      const finishReason =
        rawFinish === 'end_turn'      ? 'stop'   :
        rawFinish === 'max_tokens'    ? 'length' :
        rawFinish === 'stop_sequence' ? 'stop'   : 'other'

      return {
        content: text,
        tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        cost: calculateCost(model, inputTokens, outputTokens),
        model,
        provider: 'anthropic',
        finishReason,
      }
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw parseAnthropicError(err)
    }
  }
}
