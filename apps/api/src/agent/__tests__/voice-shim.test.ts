import { describe, expect, it } from 'vitest'
import {
  buildCompletion,
  buildStreamFrames,
  findTransferTool,
  lastUserMessage,
  messageText,
  sentenceChunks,
  toolContinuation,
  transferLooksFailed,
  voiceCallerPhone,
  voiceVisitorKey,
  type VoiceCompletionBody,
} from '../voice-shim'

const body = (over: Partial<VoiceCompletionBody> = {}): VoiceCompletionBody => ({
  messages: [
    { role: 'system', content: 'you are an agent' },
    { role: 'assistant', content: 'Hi, this is the AI assistant.' },
    { role: 'user', content: 'Do you have parking?' },
  ],
  stream: true,
  model: 'omniply-agent',
  ...over,
})

describe('messageText / lastUserMessage', () => {
  it('reads string content', () => {
    expect(lastUserMessage(body())).toBe('Do you have parking?')
  })

  it('reads parts-array content', () => {
    const b = body({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'there' }] }],
    })
    expect(lastUserMessage(b)).toBe('hello there')
  })

  it('returns null with no user message', () => {
    expect(lastUserMessage(body({ messages: [{ role: 'assistant', content: 'hi' }] }))).toBeNull()
    expect(lastUserMessage({})).toBeNull()
  })

  it('picks the LAST user message', () => {
    const b = body({
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'ok' },
        { role: 'user', content: 'second' },
      ],
    })
    expect(lastUserMessage(b)).toBe('second')
  })

  it('handles null content', () => {
    expect(messageText({ role: 'user', content: null })).toBe('')
  })
})

describe('voiceVisitorKey', () => {
  it('prefers CALL_ID interpolated into the system message (phone calls)', () => {
    const b = body({
      messages: [
        { role: 'system', content: 'You are the practice assistant. CALL_ID=conv_9701m23w CALLER=+61400111222' },
        { role: 'user', content: 'hello' },
      ],
      elevenlabs_extra_body: { conversation_id: 'sdk-session-id' },
    })
    const r = voiceVisitorKey(b)
    expect(r.source).toBe('call_id')
    expect(r.key).toBe('el-conv_9701m23w')
  })

  it('ignores an un-interpolated CALL_ID template', () => {
    const b = body({
      messages: [
        { role: 'system', content: 'CALL_ID={{system__conversation_id}}' },
        { role: 'user', content: 'hello' },
      ],
    })
    expect(voiceVisitorKey(b).source).toBe('opener-hash')
  })

  it('prefers elevenlabs conversation_id and sanitizes it', () => {
    const r = voiceVisitorKey(body({ elevenlabs_extra_body: { conversation_id: 'conv 123/abc' } }))
    expect(r.source).toBe('conversation_id')
    expect(r.key).toBe('el-conv123abc')
  })

  it('hashes caller_id (no raw phone number in the key)', () => {
    const r = voiceVisitorKey(body({ elevenlabs_extra_body: { caller_id: '+61400111222' } }))
    expect(r.source).toBe('caller_id')
    expect(r.key).toMatch(/^elc-[0-9a-f]{24}$/)
    expect(r.key).not.toContain('61400111222')
  })

  it('falls back to the OpenAI user field, then opener hash', () => {
    expect(voiceVisitorKey(body({ user: 'visitor_9' })).source).toBe('user')
    const r = voiceVisitorKey(body())
    expect(r.source).toBe('opener-hash')
    expect(r.key).toMatch(/^elh-[0-9a-f]{24}$/)
    // Deterministic for the same opener (stable within one call).
    expect(voiceVisitorKey(body()).key).toBe(r.key)
  })
})

describe('voiceCallerPhone', () => {
  const withSystem = (content: string): VoiceCompletionBody => ({
    messages: [
      { role: 'system', content },
      { role: 'user', content: 'hi' },
    ],
  })

  it('parses an E.164 caller', () => {
    expect(voiceCallerPhone(withSystem('CALL_ID=conv_1 CALLER=+61400111222'))).toBe('+61400111222')
  })

  it('parses formatted numbers', () => {
    expect(voiceCallerPhone(withSystem('CALLER=+1 (829) 731-2601'))).toBe('+18297312601')
  })

  it('null on anonymous or un-interpolated template', () => {
    expect(voiceCallerPhone(withSystem('CALLER=anonymous'))).toBeNull()
    expect(voiceCallerPhone(withSystem('CALLER={{system__caller_id}}'))).toBeNull()
    expect(voiceCallerPhone({ messages: [{ role: 'user', content: 'hi' }] })).toBeNull()
  })
})

describe('findTransferTool', () => {
  it('finds the transfer tool by name', () => {
    const b = body({
      tools: [
        { type: 'function', function: { name: 'end_call' } },
        { type: 'function', function: { name: 'transfer_to_number' } },
      ],
    })
    expect(findTransferTool(b)).toBe('transfer_to_number')
  })

  it('returns null when absent', () => {
    expect(findTransferTool(body())).toBeNull()
    expect(findTransferTool(body({ tools: [{ type: 'function', function: { name: 'end_call' } }] }))).toBeNull()
  })
})

describe('sentenceChunks', () => {
  it('splits on sentence boundaries and preserves all text', () => {
    const chunks = sentenceChunks('First one. Second one! Third?')
    expect(chunks).toHaveLength(3)
    expect(chunks.join('')).toBe('First one. Second one! Third?')
  })

  it('keeps a single sentence whole', () => {
    expect(sentenceChunks('Just one sentence with no end')).toEqual(['Just one sentence with no end'])
  })
})

describe('toolContinuation', () => {
  it('normal visitor turn is not a continuation', () => {
    expect(toolContinuation(body())).toBeNull()
  })

  it('tool-result message after the last user turn is a continuation', () => {
    const b = body({
      messages: [
        { role: 'user', content: 'get me a human' },
        { role: 'assistant', content: 'Connecting you now.' },
        { role: 'tool', content: 'transfer initiated' },
      ],
    })
    expect(toolContinuation(b)).toBe('transfer initiated')
  })

  it('assistant tool_calls with no later user turn is a continuation', () => {
    const b = body({
      messages: [
        { role: 'user', content: 'get me a human' },
        { role: 'assistant', content: 'Connecting you now.', tool_calls: [{}] } as never,
      ],
    })
    expect(toolContinuation(b)).toBe('')
  })

  it('a NEW user message after the tool result is a normal turn again', () => {
    const b = body({
      messages: [
        { role: 'user', content: 'get me a human' },
        { role: 'tool', content: 'transfer failed' },
        { role: 'user', content: 'hello? anyone?' },
      ],
    })
    expect(toolContinuation(b)).toBeNull()
  })

  it('transferLooksFailed classifies results', () => {
    expect(transferLooksFailed('transfer failed: no-answer')).toBe(true)
    expect(transferLooksFailed('busy')).toBe(true)
    expect(transferLooksFailed('transfer initiated')).toBe(false)
    expect(transferLooksFailed('')).toBe(false)
  })
})

describe('response encoding', () => {
  it('non-streaming completion carries the reply', () => {
    const c = buildCompletion({ reply: 'We have free parking behind the building.', transferToolName: null, model: 'm' }) as {
      object: string
      choices: { message: { content: string; tool_calls?: unknown }; finish_reason: string }[]
    }
    expect(c.object).toBe('chat.completion')
    expect(c.choices[0].message.content).toBe('We have free parking behind the building.')
    expect(c.choices[0].finish_reason).toBe('stop')
    expect(c.choices[0].message.tool_calls).toBeUndefined()
  })

  it('transfer plan emits a tool call with the required args, empty content', () => {
    const c = buildCompletion({
      reply: 'Connecting you now.',
      transferToolName: 'transfer_to_number',
      transferNumber: '+18297312601',
      model: 'm',
    }) as {
      choices: { message: { content: string; tool_calls: { function: { name: string; arguments: string } }[] }; finish_reason: string }[]
    }
    expect(c.choices[0].finish_reason).toBe('tool_calls')
    const fn = c.choices[0].message.tool_calls[0].function
    expect(fn.name).toBe('transfer_to_number')
    const args = JSON.parse(fn.arguments) as {
      transfer_number: string
      system__message_to_speak: string
      agent_message: string
    }
    expect(args.transfer_number).toBe('+18297312601')
    // The live offered schema's spoken-while-dialing field (NOT client_message).
    expect(args.system__message_to_speak).toBe('Connecting you now.')
    expect(args.agent_message).toBeTruthy()
    // Spoken line rides in client_message, so content must be empty (no double).
    expect(c.choices[0].message.content).toBe('')
  })

  it('stream frames: role first, full reply across deltas, [DONE] last', () => {
    const frames = buildStreamFrames({ reply: 'One. Two.', transferToolName: null, model: 'm' })
    expect(frames[0]).toContain('"role":"assistant"')
    expect(frames[frames.length - 1]).toBe('data: [DONE]\n\n')
    const text = frames
      .filter((f) => f.startsWith('data: {'))
      .map((f) => JSON.parse(f.slice(6)) as { choices: { delta: { content?: string } }[] })
      .map((c) => c.choices[0].delta.content ?? '')
      .join('')
    expect(text).toBe('One. Two.')
    expect(frames.some((f) => f.includes('"finish_reason":"stop"'))).toBe(true)
  })

  it('stream frames with transfer: tool call, NO spoken content, tool_calls finish', () => {
    const frames = buildStreamFrames({
      reply: 'Connecting you.',
      transferToolName: 'transfer_to_number',
      transferNumber: '+18297312601',
      model: 'm',
    })
    expect(frames.some((f) => f.includes('transfer_to_number'))).toBe(true)
    expect(frames.some((f) => f.includes('"finish_reason":"tool_calls"'))).toBe(true)
    expect(frames.some((f) => f.includes('"finish_reason":"stop"'))).toBe(false)
    // The spoken line must NOT appear as streamed content (only in the tool's
    // client_message arg) — this is the 3×-repeat regression guard.
    const content = frames
      .filter((f) => f.startsWith('data: {'))
      .map((f) => JSON.parse(f.slice(6)) as { choices: { delta: { content?: string } }[] })
      .map((c) => c.choices[0].delta.content ?? '')
      .join('')
    expect(content).toBe('')
  })

  it('every stream frame is valid SSE', () => {
    for (const f of buildStreamFrames({ reply: 'Hi there.', transferToolName: null, model: 'm' })) {
      expect(f.startsWith('data: ')).toBe(true)
      expect(f.endsWith('\n\n')).toBe(true)
    }
  })
})
