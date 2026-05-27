import { describe, it, expect } from 'vitest'
import { AudioSpeechBody } from '../../src/schemas/audio-speech.js'

describe('AudioSpeechBody', () => {
  it('parses grok-tts with defaults', () => {
    const r = AudioSpeechBody.parse({ model: 'grok-tts', input: 'hi', voice: 'alloy' })
    expect(r.response_format).toBe('mp3')
    expect(r.speed).toBe(1)
  })
  it('rejects unknown audio model', () => {
    expect(() => AudioSpeechBody.parse({ model: 'no-such', input: 'x', voice: 'alloy' })).toThrow()
  })
})
