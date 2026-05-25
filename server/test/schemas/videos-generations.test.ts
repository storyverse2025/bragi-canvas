import { describe, it, expect } from 'vitest'
import { VideosGenerationsBody } from '../../src/schemas/videos-generations.js'

describe('VideosGenerationsBody', () => {
  it('parses kling-3.0', () => {
    const r = VideosGenerationsBody.parse({
      model: 'kling-3.0', prompt: 'cat walks', aspectRatio: '9:16',
    })
    expect(r.duration).toBe('5')
  })
  it('parses seedance-2.0 with defaults', () => {
    const r = VideosGenerationsBody.parse({
      model: 'seedance-2.0', prompt: 'x', ratio: '16:9',
    })
    expect(r.resolution).toBe('1080p')
    expect(r.generate_audio).toBe(true)
  })
  it('rejects unknown video model', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'no-such-video', prompt: 'x',
    })).toThrow()
  })
})
