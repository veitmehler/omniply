import { GoogleGenerativeAI } from '@google/generative-ai'
import { getSystemApiKey } from '../../lib/system-keys'
import { calculateCost, GROUNDED_SEARCH_FEE_USD } from './cost-table'
import type { LLMAdapter, LLMCallOptions, LLMResponse } from './adapter'
import { LLMError } from './adapter'
import { instrumentCall } from '../../lib/net/instrument'

const DEFAULT_MODEL = 'gemini-3.5-flash'

/** Maximum time to wait for a single Gemini API call (search or standard). */
const GEMINI_FETCH_TIMEOUT_MS = 180_000 // 3 minutes

function parseGeminiError(err: unknown): LLMError {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()

  // Timeout / abort (covers AbortSignal.timeout, fetch failed, AbortError)
  if (
    lower.includes('abort') ||
    lower.includes('timed out') ||
    lower.includes('fetch failed') ||
    lower.includes('etimedout') ||
    lower.includes('econnreset')
  ) {
    return new LLMError(msg, { quotaType: 'timeout', retryAfterSeconds: 5 })
  }

  // Daily quota exhausted
  if (lower.includes('quota') || lower.includes('resource_exhausted')) {
    const llmErr = new LLMError(msg, { quotaType: 'daily' })
    // Try to extract retryAfterSeconds from errorDetails
    try {
      const detailMatch = msg.match(/"retryDelay":"(\d+)s"/)
      if (detailMatch) llmErr.retryAfterSeconds = parseInt(detailMatch[1], 10)
    } catch { /* ignore */ }
    return llmErr
  }

  // Rate limit (429)
  if (lower.includes('429') || lower.includes('rate_limit') || lower.includes('rate limit')) {
    const retryMatch = msg.match(/retry in ([\d.]+)s/i)
    return new LLMError(msg, {
      quotaType: 'rate_limit',
      retryAfterSeconds: retryMatch ? Math.ceil(parseFloat(retryMatch[1])) : 60,
    })
  }

  // Server overloaded
  if (lower.includes('503') || lower.includes('overloaded')) {
    return new LLMError(msg, { quotaType: 'overloaded', retryAfterSeconds: 30 })
  }

  return new LLMError(msg, { quotaType: 'unknown' })
}

export class GeminiAdapter implements LLMAdapter {
  getProvider() { return 'gemini' }

  supportsModel(model: string) {
    return model.startsWith('gemini')
  }

  async call(options: LLMCallOptions): Promise<LLMResponse> {
    const apiKey = await getSystemApiKey('gemini')
    if (!apiKey) throw new LLMError('No API key configured for provider: gemini')

    const model = options.model || DEFAULT_MODEL
    const temperature = options.temperature ?? 0.7
    const maxTokens = options.maxTokens ?? 8192

    try {
      if (options.useGenerativeSearch) {
        return await this.callWithSearch(apiKey, model, options, temperature, maxTokens)
      }
      return await this.callStandard(apiKey, model, options, temperature, maxTokens)
    } catch (err) {
      if (err instanceof LLMError) throw err
      throw parseGeminiError(err)
    }
  }

  private async callStandard(
    apiKey: string,
    model: string,
    options: LLMCallOptions,
    temperature: number,
    maxTokens: number,
  ): Promise<LLMResponse> {
    const genAI = new GoogleGenerativeAI(apiKey)
    const generationConfig: Record<string, unknown> = {
      temperature,
      maxOutputTokens: maxTokens,
      ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      ...(options.thinkingBudget !== undefined
        ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
        : {}),
    }

    const genModel = genAI.getGenerativeModel({
      model,
      ...(options.systemPrompt ? { systemInstruction: options.systemPrompt } : {}),
      generationConfig: generationConfig as Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]['generationConfig'],
    })

    const result = await instrumentCall({ provider: 'gemini', op: `generateContent:${model}` }, () =>
      genModel.generateContent(options.userPrompt, { timeout: GEMINI_FETCH_TIMEOUT_MS }),
    )
    const response = result.response

    if (response.promptFeedback?.blockReason) {
      throw new LLMError(`Gemini blocked: ${response.promptFeedback.blockReason}`)
    }

    const text = response.text() || ''
    if (!text.trim()) throw new LLMError('Gemini returned empty response')

    const inputTokens = response.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0

    const rawFinish = response.candidates?.[0]?.finishReason
    const finishReason =
      rawFinish === 'STOP'       ? 'stop'   :
      rawFinish === 'MAX_TOKENS' ? 'length' :
      rawFinish === 'SAFETY'     ? 'filter' : 'other'

    return {
      content: text,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      cost: calculateCost(model, inputTokens, outputTokens),
      model,
      provider: 'gemini',
      finishReason,
    }
  }

  private async callWithSearch(
    apiKey: string,
    model: string,
    options: LLMCallOptions,
    temperature: number,
    maxTokens: number,
  ): Promise<LLMResponse> {
    // Concatenate system + user prompt as the search endpoint ignores systemInstruction
    const combinedPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${options.userPrompt}`
      : options.userPrompt

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
    const body = {
      contents: [{ role: 'user', parts: [{ text: combinedPrompt }] }],
      tools: [{ google_search: {} }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(options.thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget: options.thinkingBudget } }
          : {}),
      },
    }

    const res = await instrumentCall({ provider: 'gemini', op: `search:${model}` }, async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(GEMINI_FETCH_TIMEOUT_MS),
      })
      if (!r.ok) {
        const errBody = await r.json().catch(() => ({}))
        const msg = errBody?.error?.message || `Gemini search API error ${r.status}`
        throw Object.assign(new Error(msg), { status: r.status })
      }
      return r
    })

    const data = await res.json()
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    if (!text.trim()) throw new LLMError('Gemini (search) returned empty response')

    const inputTokens = data?.usageMetadata?.promptTokenCount ?? 0
    const outputTokens = data?.usageMetadata?.candidatesTokenCount ?? 0

    const rawFinish = data?.candidates?.[0]?.finishReason
    const finishReason =
      rawFinish === 'STOP'       ? 'stop'   :
      rawFinish === 'MAX_TOKENS' ? 'length' :
      rawFinish === 'SAFETY'     ? 'filter' : 'other'

    // Extract grounding source URLs from Gemini's search metadata
    const chunks = (data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as Array<{
      web?: { uri?: string; title?: string; domain?: string }
    }>
    const groundingSources = chunks
      .filter((c) => c.web?.uri)
      .map((c) => ({
        title: c.web!.title ?? '',
        uri: c.web!.uri!,
        domain: c.web!.domain ?? undefined,
      }))

    return {
      content: text,
      tokens: { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens },
      // Grounded requests carry Google's per-request search fee on top of
      // tokens — adding it HERE propagates to every recorder automatically.
      cost: calculateCost(model, inputTokens, outputTokens) + GROUNDED_SEARCH_FEE_USD,
      model,
      provider: 'gemini',
      finishReason,
      ...(groundingSources.length > 0 ? { groundingSources } : {}),
    }
  }
}
