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

  // ---------------------------------------------------------------------------
  // grok-tts — language param parity with plugin src/models/audio.ts grokTTS
  // ---------------------------------------------------------------------------

  it('grok-tts language defaults to auto', () => {
    const r = AudioSpeechBody.parse({ model: 'grok-tts', input: 'hi', voice: 'alloy' })
    expect((r as any).language).toBe('auto')
  })

  it('grok-tts accepts all plugin language values', () => {
    const langs = ['auto', 'en', 'zh', 'es', 'de', 'fr', 'ja', 'ko', 'pt-BR'] as const
    for (const language of langs) {
      const r = AudioSpeechBody.parse({ model: 'grok-tts', input: 'hi', voice: 'alloy', language })
      expect((r as any).language).toBe(language)
    }
  })

  it('grok-tts rejects unknown language value', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'grok-tts', input: 'hi', voice: 'alloy', language: 'it',
    })).toThrow()
  })

  it('grok-tts rejects another unknown language value', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'grok-tts', input: 'hi', voice: 'alloy', language: 'ru',
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // elevenlabs-tts-v3 — voice_settings parity with plugin src/models/audio.ts
  // ---------------------------------------------------------------------------

  it('elevenlabs-tts-v3 parses without voice_settings (optional)', () => {
    const r = AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3', input: 'hello', voice: 'adam',
    })
    expect((r as any).voice_settings).toBeUndefined()
  })

  it('elevenlabs-tts-v3 parses voice_settings with all fields', () => {
    const r = AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: {
        stability: 0.7,
        similarity_boost: 0.8,
        style: 0.2,
        speed: 1.1,
      },
    })
    expect((r as any).voice_settings.stability).toBe(0.7)
    expect((r as any).voice_settings.similarity_boost).toBe(0.8)
    expect((r as any).voice_settings.style).toBe(0.2)
    expect((r as any).voice_settings.speed).toBe(1.1)
  })

  it('elevenlabs-tts-v3 voice_settings applies schema defaults when object provided without fields', () => {
    const r = AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: {},
    })
    expect((r as any).voice_settings.stability).toBe(0.5)
    expect((r as any).voice_settings.similarity_boost).toBe(0.75)
    expect((r as any).voice_settings.style).toBe(0)
    expect((r as any).voice_settings.speed).toBe(1)
  })

  it('elevenlabs-tts-v3 rejects stability out of range (> 1)', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: { stability: 2 },
    })).toThrow()
  })

  it('elevenlabs-tts-v3 rejects stability out of range (< 0)', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: { stability: -0.1 },
    })).toThrow()
  })

  it('elevenlabs-tts-v3 rejects speed out of range (speed=0.5, min is 0.7)', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: { speed: 0.5 },
    })).toThrow()
  })

  it('elevenlabs-tts-v3 rejects speed out of range (speed=1.5, max is 1.2)', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'elevenlabs-tts-v3',
      input: 'hello',
      voice: 'adam',
      voice_settings: { speed: 1.5 },
    })).toThrow()
  })

  it('elevenlabs-tts-v3 accepts speed at boundaries (0.7 and 1.2)', () => {
    for (const speed of [0.7, 1.2]) {
      const r = AudioSpeechBody.parse({
        model: 'elevenlabs-tts-v3',
        input: 'hello',
        voice: 'adam',
        voice_settings: { speed },
      })
      expect((r as any).voice_settings.speed).toBe(speed)
    }
  })

  // ---------------------------------------------------------------------------
  // minimax-tts — voice enum + speed enum parity with plugin src/models/audio.ts
  // ---------------------------------------------------------------------------

  it('minimax-tts parses with defaults', () => {
    const r = AudioSpeechBody.parse({ model: 'minimax-tts', input: 'Hello' })
    expect((r as any).voice).toBe('English_Graceful_Lady')
    expect((r as any).speed).toBe('1.0')
  })

  it('minimax-tts accepts all 12 voice options from plugin', () => {
    const voices = [
      'English_Graceful_Lady',
      'English_Insightful_Speaker',
      'English_radiant_girl',
      'English_Persuasive_Man',
      'English_Lucky_Robot',
      'Chinese (Mandarin)_Gentleman',
      'Chinese (Mandarin)_Unrestrained_Young_Man',
      'Chinese (Mandarin)_Straightforward_Boy',
      'Chinese (Mandarin)_Warm_HeartedGirl',
      'Chinese (Mandarin)_IntellectualGirl',
      'Chinese (Mandarin)_Cute_Spirit',
      'Chinese (Mandarin)_Stubborn_Friend',
    ] as const
    for (const voice of voices) {
      const r = AudioSpeechBody.parse({ model: 'minimax-tts', input: 'test', voice })
      expect((r as any).voice).toBe(voice)
    }
  })

  it('minimax-tts accepts all 6 speed options from plugin', () => {
    const speeds = ['0.5', '0.75', '1.0', '1.25', '1.5', '2.0'] as const
    for (const speed of speeds) {
      const r = AudioSpeechBody.parse({ model: 'minimax-tts', input: 'test', voice: 'English_Graceful_Lady', speed })
      expect((r as any).speed).toBe(speed)
    }
  })

  it('minimax-tts rejects an unknown voice', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'minimax-tts', input: 'test', voice: 'Unknown_Voice',
    })).toThrow()
  })

  it('minimax-tts rejects an invalid speed value', () => {
    expect(() => AudioSpeechBody.parse({
      model: 'minimax-tts', input: 'test', voice: 'English_Graceful_Lady', speed: '3.0',
    })).toThrow()
  })
})
