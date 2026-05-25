import { describe, it, expect } from 'vitest'
import { AudioMusicBody } from '../../src/schemas/audio-music.js'

describe('AudioMusicBody', () => {
  it('parses elevenlabs-music with defaults', () => {
    const r = AudioMusicBody.parse({ model: 'elevenlabs-music', prompt: 'jazz' })
    expect(r.duration_ms).toBe(30000)
    expect(r.instrumental).toBe(false)
  })
  it('rejects unknown audio model', () => {
    expect(() => AudioMusicBody.parse({ model: 'no-such-music', prompt: 'x' })).toThrow()
  })
})
