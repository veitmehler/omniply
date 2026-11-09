export interface LLMResponse {
  content: string
  tokens: { input: number; output: number; total: number }
  cost: number
  model: string
  provider: string
  /** Normalised stop signal from the provider.
   *  'stop'     — model finished naturally (end of sequence / stop token)
   *  'length'   — output was cut off at the maxTokens ceiling (potential truncation)
   *  'filter'   — content safety filter halted generation
   *  'other'    — any other provider-specific reason
   */
  finishReason: 'stop' | 'length' | 'filter' | 'other'
  /** Raw grounding source URIs returned by Gemini search. Redirect URIs need resolution. */
  groundingSources?: Array<{ title: string; uri: string; domain?: string }>
  /** B16: spans of the generated text and the indices (into groundingChunkUris) of the pages they rest on. */
  groundingSupports?: Array<{ text: string; chunkIndices: number[] }>
  /** Unfiltered chunk URIs, index-aligned with groundingSupports.chunkIndices. */
  groundingChunkUris?: Array<string | null>
}

export interface LLMCallOptions {
  systemPrompt?: string | null
  userPrompt: string
  model: string
  temperature?: number
  maxTokens?: number
  useGenerativeSearch?: boolean
  /** Force JSON output mode (Gemini: responseMimeType = 'application/json'). */
  jsonMode?: boolean
  /** Gemini 2.5: set `0` to disable thinking so output budget is not consumed by reasoning tokens. */
  thinkingBudget?: number
  /**
   * Image parts attached to the user turn (vision input). Only OpenAIAdapter honors this today —
   * see .plans/client-story-review-mining.implementation-plan.md. Other adapters ignore it.
   */
  images?: Array<{ mimeType: string; base64: string }>
}

export interface LLMAdapter {
  call(options: LLMCallOptions): Promise<LLMResponse>
  getProvider(): string
  supportsModel(model: string): boolean
}

export class LLMError extends Error {
  quotaType?: 'daily' | 'rate_limit' | 'overloaded' | 'timeout' | 'unknown'
  retryAfterSeconds?: number
  quotaLimit?: string

  constructor(
    message: string,
    opts?: { quotaType?: LLMError['quotaType']; retryAfterSeconds?: number; quotaLimit?: string },
  ) {
    super(message)
    this.name = 'LLMError'
    if (opts) {
      this.quotaType = opts.quotaType
      this.retryAfterSeconds = opts.retryAfterSeconds
      this.quotaLimit = opts.quotaLimit
    }
  }
}
