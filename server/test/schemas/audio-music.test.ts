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

  // ---------------------------------------------------------------------------
  // minimax-music — instrumental string enum parity with plugin src/models/audio.ts
  // ---------------------------------------------------------------------------

  it('minimax-music parses with defaults (instrumental=true)', () => {
    const r = AudioMusicBody.parse({ model: 'minimax-music', prompt: 'ambient chill' })
    expect((r as any).instrumental).toBe('true')
  })

  it('minimax-music accepts instrumental=true', () => {
    const r = AudioMusicBody.parse({ model: 'minimax-music', prompt: 'ambient', instrumental: 'true' })
    expect((r as any).instrumental).toBe('true')
  })

  it('minimax-music accepts instrumental=false (with lyrics)', () => {
    const r = AudioMusicBody.parse({ model: 'minimax-music', prompt: 'pop song', instrumental: 'false' })
    expect((r as any).instrumental).toBe('false')
  })

  it('minimax-music rejects boolean instrumental (expects string enum)', () => {
    expect(() => AudioMusicBody.parse({ model: 'minimax-music', prompt: 'test', instrumental: true })).toThrow()
  })

  it('minimax-music rejects invalid instrumental value', () => {
    expect(() => AudioMusicBody.parse({ model: 'minimax-music', prompt: 'test', instrumental: 'yes' })).toThrow()
  })

  it('minimax-music requires prompt', () => {
    expect(() => AudioMusicBody.parse({ model: 'minimax-music' })).toThrow()
  })
})
