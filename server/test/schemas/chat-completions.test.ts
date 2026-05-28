import { describe, it, expect } from 'vitest'
import { ChatCompletionsBody } from '../../src/schemas/chat-completions.js'

describe('ChatCompletionsBody schema', () => {
  it('parses valid gpt-5.5-pro request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'gpt-5.5-pro',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('gpt-5.5-pro')
  })

  it('rejects unknown model', () => {
    expect(() => ChatCompletionsBody.parse({ model: 'no-such-model', messages: [] })).toThrow()
  })

  it('rejects gpt with invalid temperature', () => {
    expect(() => ChatCompletionsBody.parse({
      model: 'gpt-5.5-pro', messages: [{ role: 'user', content: 'x' }], temperature: 5,
    })).toThrow()
  })
})
