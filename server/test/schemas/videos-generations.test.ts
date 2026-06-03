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
    // resolution is always sent to Volcengine Ark (default '720p').
    // The old comment "resolution was removed from schema (Volcengine Ark does
    // not accept it)" was stale/wrong — the plugin has always forwarded it.
    expect(r.generate_audio).toBe(true)
    expect((r as any).resolution).toBe('720p')
  })

  it('seedance-2.0 parses each of 480p/720p/1080p', () => {
    for (const res of ['480p', '720p', '1080p'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'seedance-2.0', prompt: 'x', ratio: '16:9', resolution: res,
      })
      expect((r as any).resolution).toBe(res)
    }
  })

  it('seedance-2.0 defaults resolution to 720p when omitted', () => {
    const r = VideosGenerationsBody.parse({
      model: 'seedance-2.0', prompt: 'x', ratio: '16:9',
    })
    expect((r as any).resolution).toBe('720p')
  })

  it('seedance-2.0-fast rejects 1080p (not in its resolution enum)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'seedance-2.0-fast', prompt: 'x', ratio: '16:9', resolution: '1080p',
    })).toThrow()
  })

  it('seedance-2.0-fast defaults resolution to 720p when omitted', () => {
    const r = VideosGenerationsBody.parse({
      model: 'seedance-2.0-fast', prompt: 'x', ratio: '16:9',
    })
    expect((r as any).resolution).toBe('720p')
  })

  it('seedance-2.0 accepts a video input_asset (schema-level v2v)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'seedance-2.0', prompt: 'x', ratio: '16:9', input_assets: ['ast_vid1'],
    })
    expect((r as any).input_assets).toEqual(['ast_vid1'])
  })

  it('seedance duration matches plugin range: -1 (auto) and 4..15 accepted, default 5', () => {
    for (const d of ['-1', '4', '7', '11', '15'] as const) {
      const r = VideosGenerationsBody.parse({ model: 'seedance-2.0', prompt: 'x', ratio: '16:9', duration: d })
      expect((r as any).duration).toBe(d)
    }
    const def = VideosGenerationsBody.parse({ model: 'seedance-2.0', prompt: 'x', ratio: '16:9' })
    expect((def as any).duration).toBe('5')
  })

  it('seedance rejects out-of-range duration (3 and 16)', () => {
    for (const d of ['3', '16'] as const) {
      expect(() => VideosGenerationsBody.parse({ model: 'seedance-2.0', prompt: 'x', ratio: '16:9', duration: d })).toThrow()
    }
  })

  it('seedance-2.0 accepts 4:3 / 3:4 ratios; seedance-2.0-fast rejects them', () => {
    for (const ratio of ['4:3', '3:4'] as const) {
      const r = VideosGenerationsBody.parse({ model: 'seedance-2.0', prompt: 'x', ratio })
      expect((r as any).ratio).toBe(ratio)
      expect(() => VideosGenerationsBody.parse({ model: 'seedance-2.0-fast', prompt: 'x', ratio })).toThrow()
    }
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

  it('grok-video parses text-to-video (no input_assets) and applies plugin defaults', () => {
    const r = VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'a cat walks',
    })
    expect(r.model).toBe('grok-video')
    expect((r as any).input_assets).toBeUndefined()
    // Defaults mirror plugin grok.ts (duration 5 / aspect_ratio 16:9 / resolution 720p)
    // so a paramless router request forwards the same fields the plugin always sends.
    expect((r as any).duration).toBe('5')
    expect((r as any).aspect_ratio).toBe('16:9')
    expect((r as any).resolution).toBe('720p')
  })

  it('grok-video accepts empty input_assets array (text-to-video, unlike veo)', () => {
    // Intentional divergence from veo: grok-video supports 0-asset t2v, so the
    // schema permits [] (adapter treats length 0 as text-to-video).
    const r = VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'a cat walks', input_assets: [],
    })
    expect((r as any).input_assets).toEqual([])
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

  it('grok-video accepts up to 3 input_assets (image-ref)', () => {
    const r = VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', input_assets: ['a', 'b', 'c'],
    })
    expect((r as any).input_assets).toHaveLength(3)
  })

  it('grok-video rejects more than 3 input_assets', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', input_assets: ['a', 'b', 'c', 'd'],
    })).toThrow()
  })

  it('grok-video accepts each mode enum value', () => {
    for (const mode of ['text-to-video', 'first-frame', 'image-ref', 'video-extend'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'grok-video', prompt: 'x', mode,
      })
      expect((r as any).mode).toBe(mode)
    }
  })

  it('grok-video rejects invalid mode', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'grok-video', prompt: 'x', mode: 'first-last-frame',
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

  // ---------------------------------------------------------------------------
  // veo-3.1 mode field
  // ---------------------------------------------------------------------------

  it('veo-3.1 accepts each mode enum value', () => {
    for (const mode of ['text-to-video', 'first-frame', 'first-last-frame', 'image-ref'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'veo-3.1', prompt: 'x', aspectRatio: '16:9', mode,
      })
      expect((r as any).mode).toBe(mode)
    }
  })

  it('veo-3.1 rejects invalid mode', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1', prompt: 'x', aspectRatio: '16:9', mode: 'video-extend',
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // veo-3.1-lite mode field — only text-to-video and first-frame supported
  // ---------------------------------------------------------------------------

  it('veo-3.1-lite accepts text-to-video and first-frame modes', () => {
    for (const mode of ['text-to-video', 'first-frame'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'veo-3.1-lite', prompt: 'x', aspectRatio: '16:9', mode,
      })
      expect((r as any).mode).toBe(mode)
    }
  })

  it('veo-3.1-lite rejects image-ref mode (not in lite enum)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1-lite', prompt: 'x', aspectRatio: '16:9', mode: 'image-ref',
    })).toThrow()
  })

  it('veo-3.1-lite rejects first-last-frame mode (not in lite enum)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'veo-3.1-lite', prompt: 'x', aspectRatio: '16:9', mode: 'first-last-frame',
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // luma-uni-1 — REMOVED from video schema (moved to image schema)
  // ---------------------------------------------------------------------------
  it('luma-uni-1 is NO LONGER accepted by the videos schema (moved to images)', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'luma-uni-1', prompt: 'a sunset', aspectRatio: '16:9',
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // kling-2.6 / kling-3.0 — mode (std/pro) parity with plugin KLING_PARAMS
  // ---------------------------------------------------------------------------

  it('kling-3.0 mode defaults to std', () => {
    const r = VideosGenerationsBody.parse({
      model: 'kling-3.0', prompt: 'cat walks', aspectRatio: '16:9',
    })
    expect((r as any).mode).toBe('std')
  })

  it('kling-2.6 mode defaults to std', () => {
    const r = VideosGenerationsBody.parse({
      model: 'kling-2.6', prompt: 'cat walks', aspectRatio: '9:16',
    })
    expect((r as any).mode).toBe('std')
  })

  it('kling-3.0 accepts mode=pro', () => {
    const r = VideosGenerationsBody.parse({
      model: 'kling-3.0', prompt: 'cat walks', aspectRatio: '16:9', mode: 'pro',
    })
    expect((r as any).mode).toBe('pro')
  })

  it('kling-3.0 accepts mode=std explicitly', () => {
    const r = VideosGenerationsBody.parse({
      model: 'kling-3.0', prompt: 'cat walks', aspectRatio: '16:9', mode: 'std',
    })
    expect((r as any).mode).toBe('std')
  })

  it('kling-3.0 rejects invalid mode value', () => {
    expect(() => VideosGenerationsBody.parse({
      model: 'kling-3.0', prompt: 'cat walks', aspectRatio: '16:9', mode: 'ultra',
    })).toThrow()
  })

  it('kling-2.6 accepts both mode values (std/pro)', () => {
    for (const mode of ['std', 'pro'] as const) {
      const r = VideosGenerationsBody.parse({
        model: 'kling-2.6', prompt: 'cat walks', aspectRatio: '16:9', mode,
      })
      expect((r as any).mode).toBe(mode)
    }
  })
})
