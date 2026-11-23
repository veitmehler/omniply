import OpenAI from 'openai'
import { getSystemApiKey } from '../../lib/system-keys'
import { meteredCost } from './metered-cost'
import type { LLMAdapter, LLMCallOptions, LLMResponse } from './adapter'
import { LLMError } from './adapter'
import { instrumentCall } from '../../lib/net/instrument'

const DEFAULT_MODEL = 'gpt-4o-mini'

// The SDK's own default is 10 minutes with 2 built-in retries — far too long
// to hold a worker slot. See .plans/social-generation-resilience.implementation-plan.md.
const OPENAI_TIMEOUT_MS = 120_000

function parseOpenAIError(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) {
    return new LLMError(msg, { quotaType: 'rate_limit', retryAfterSeconds: 60 })
  }

  if (lower.includes('quota') || lower.includes('insufficient')) {
    return new LLMError(msg, { quotaType: 'daily' })
  }

  return new LLMError(msg, { quotaType: 'unknown' })
}

export class OpenAIAdapter implements LLMAdapter {
  getProvider() { return 'openai' }

  supportsModel(model: string) {
    return model.startsWith('gpt')
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const apiKey = await getSystemApiKey('openai')
    if (!apiKey) throw new LLMError('No API key configured for provider: openai')

    const model = options.model || DEFAULT_MODEL
    const temperature = options.temperature ?? 0.7
    const maxTokens = options.maxTokens

    // OpenAI rejects response_format json_object unless the word "json" appears
    // in the messages (400). DB-backed prompts don't all say it (surfaced live
    // on prod's quote-selection row 2026-07-11) — guarantee it at the adapter.
    let userPrompt = options.userPrompt
    if (
      options.jsonMode &&
      !/json/i.test(options.userPrompt) &&
      !/json/i.test(options.systemPrompt ?? '')
    ) {
      userPrompt = `${options.userPrompt}\n\nRespond with valid JSON only.`
    }

    try {
      const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS })
      const messages: OpenAI.ChatCompletionMessageParam[] = []
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt })
      }
      if (options.images?.length) {
        const content: OpenAI.ChatCompletionContentPart[] = [
          { type: 'text', text: userPrompt },
          ...options.images.map(
            (img): OpenAI.ChatCompletionContentPart => ({
              type: 'image_url',
              image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
            }),
          ),
        ]
        messages.push({ role: 'user', content })
      } else {
        messages.push({ role: 'user', content: userPrompt })
      }

      const response = await instrumentCall({ provider: 'openai', op: `chat.completions.create:${model}` }, () =>
        client.chat.completions.create({
          model,
          messages,
          temperature,
          ...(maxTokens ? { max_completion_tokens: maxTokens } : {}),
          ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        }),
      )

      const choice = response.choices[0]
      const text = choice?.message?.content ?? ''
      if (!text.trim()) throw new LLMError('OpenAI returned empty response')

      const inputTokens = response.usage?.prompt_tokens ?? 0
      const outputTokens = response.usage?.completion_tokens ?? 0

      const rawFinish = choice?.finish_reason
      const finishReason =
        rawFinish === 'stop'           ? 'stop'   :
        rawFinish === 'length'         ? 'length' :
        rawFinish === 'content_filter' ? 'filter' : 'other'

      return {
        content: text,
        tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
        cost: meteredCost('openai', model, inputTokens, outputTokens),
        model,
        provider: 'openai',
        finishReason,
      }
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw parseOpenAIError(err)
    }
  }
}
