import { describe, it, expect } from 'vitest'
import { AudioSfxBody } from '../../src/schemas/audio-sfx.js'

describe('AudioSfxBody', () => {
  it('parses elevenlabs-sfx with defaults', () => {
    const r = AudioSfxBody.parse({ model: 'elevenlabs-sfx', prompt: 'thunder' })
    expect(r.duration_seconds).toBe(5)
  })
  it('rejects unknown audio model', () => {
    expect(() => AudioSfxBody.parse({ model: 'no-such-sfx', prompt: 'x' })).toThrow()
  })
})
