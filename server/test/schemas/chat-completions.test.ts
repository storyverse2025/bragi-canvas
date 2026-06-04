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

  // new text models
  it('parses valid gpt-5.5 request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'gpt-5.5',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('gpt-5.5')
  })

  it('parses valid gemini-3.5-flash request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'gemini-3.5-flash',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('gemini-3.5-flash')
  })

  it('parses valid claude-opus-4-7 request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('claude-opus-4-7')
  })

  it('parses valid claude-sonnet-4-6 request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('claude-sonnet-4-6')
  })

  it('parses valid grok-4-3 request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'grok-4-3',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('grok-4-3')
  })

  it('parses valid grok-4-fast request', () => {
    const r = ChatCompletionsBody.parse({
      model: 'grok-4-fast',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.model).toBe('grok-4-fast')
  })

  it('still rejects out-of-list model after new additions', () => {
    expect(() => ChatCompletionsBody.parse({ model: 'gpt-4-turbo', messages: [{ role: 'user', content: 'x' }] })).toThrow()
  })
})
