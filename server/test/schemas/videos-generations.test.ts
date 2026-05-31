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
    // resolution was removed from schema (Volcengine Ark does not accept it)
    expect(r.generate_audio).toBe(true)
  })
  it('rejects unknown video model', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'no-such-video', prompt: 'x',
    })).toThrow()
  })
  // ---------------------------------------------------------------------------
  // grok-video — t2v / first-frame / video-extend (mode inferred by adapter from
  // input_asset mimeType) + duration / aspect_ratio / resolution params.
  // ---------------------------------------------------------------------------

  it('grok-video parses text-to-video (no input_assets)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'a cat walks',
    })
    expect(r.model).toBe('grok-video')
    expect((r as any).input_assets).toBeUndefined()
    expect((r as any).duration).toBeUndefined()
    expect((r as any).aspect_ratio).toBeUndefined()
    expect((r as any).resolution).toBeUndefined()
  })

  it('grok-video parses with input_assets (first-frame or video-extend)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'a cat walks', input_assets: ['asset_abc123'],
    })
    expect(r.model).toBe('grok-video')
    expect((r as any).input_assets).toEqual(['asset_abc123'])
  })

  it('grok-video parses with duration / aspect_ratio / resolution', () => {
    const r = VideosGenerationsBody.parse({
      model: 'grok-video',
      prompt: 'x',
      duration: '10',
      aspect_ratio: '9:16',
      resolution: '1080p',
    })
    expect((r as any).duration).toBe('10')
    expect((r as any).aspect_ratio).toBe('9:16')
    expect((r as any).resolution).toBe('1080p')
  })

  it('grok-video accepts all plugin duration values (5/10/15)', () => {
    for (const d of ['5', '10', '15'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'grok-video', prompt: 'x', duration: d,
      })
      expect((r as any).duration).toBe(d)
    }
  })

  it('grok-video rejects more than 1 input_asset', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', input_assets: ['a', 'b'],
    })).toThrow()
  })

  it('grok-video rejects out-of-enum duration', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', duration: '6',
    })).toThrow()
  })

  it('grok-video rejects out-of-enum aspect_ratio', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', aspect_ratio: '21:9',
    })).toThrow()
  })

  it('grok-video rejects out-of-enum resolution', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', resolution: '4k',
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // veo-3.1 / veo-3.1-lite — input_assets, durationSeconds, resolution
  // ---------------------------------------------------------------------------

  it('veo-3.1 parses text-to-video (no input_assets)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'veo-3.1', prompt: 'a sunset', aspectRatio: '16:9',
    })
    expect(r.model).toBe('veo-3.1')
    expect((r as any).input_assets).toBeUndefined()
    expect((r as any).durationSeconds).toBeUndefined()
    expect((r as any).resolution).toBeUndefined()
  })

  it('veo-3.1 parses with input_assets (first-frame), durationSeconds, resolution', () => {
    const r = VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: ['ast_img1'],
      durationSeconds: 8,
      resolution: '1080p',
    })
    expect((r as any).input_assets).toEqual(['ast_img1'])
    expect((r as any).durationSeconds).toBe(8)
    expect((r as any).resolution).toBe('1080p')
  })

  it('veo-3.1 accepts up to 3 input_assets (image-ref)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: ['ast_a', 'ast_b', 'ast_c'],
    })
    expect((r as any).input_assets).toHaveLength(3)
  })

  it('veo-3.1 rejects more than 3 input_assets', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: ['ast_a', 'ast_b', 'ast_c', 'ast_d'],
    })).toThrow()
  })

  it('veo-3.1 rejects empty input_assets array', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: [],
    })).toThrow()
  })

  it('veo-3.1 rejects durationSeconds below min (2)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'x',
      aspectRatio: '16:9',
      durationSeconds: 1,
    })).toThrow()
  })

  it('veo-3.1 rejects durationSeconds above max (15)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'x',
      aspectRatio: '16:9',
      durationSeconds: 16,
    })).toThrow()
  })

  it('veo-3.1 rejects non-integer durationSeconds', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'x',
      aspectRatio: '16:9',
      durationSeconds: 8.5,
    })).toThrow()
  })

  it('veo-3.1 rejects out-of-enum resolution', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1',
      prompt: 'x',
      aspectRatio: '16:9',
      resolution: '4k',
    })).toThrow()
  })

  it('veo-3.1-lite accepts exactly 1 input_asset', () => {
    const r = VideosGenerationsBody.parse({
      model: 'veo-3.1-lite',
      prompt: 'a sunset',
      aspectRatio: '9:16',
      input_assets: ['ast_img1'],
      durationSeconds: 5,
      resolution: '720p',
    })
    expect((r as any).input_assets).toEqual(['ast_img1'])
    expect((r as any).durationSeconds).toBe(5)
    expect((r as any).resolution).toBe('720p')
  })

  it('veo-3.1-lite rejects more than 1 input_asset', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1-lite',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: ['ast_a', 'ast_b'],
    })).toThrow()
  })

  it('veo-3.1-lite rejects empty input_assets array', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1-lite',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      input_assets: [],
    })).toThrow()
  })

  it('veo-3.1-lite parses text-to-video (no input_assets)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'veo-3.1-lite', prompt: 'x', aspectRatio: '16:9',
    })
    expect(r.model).toBe('veo-3.1-lite')
  })
})
