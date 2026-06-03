import { describe, it, expect } from 'vitest'
import { ImagesGenerationsBody } from '../../src/schemas/images-generations.js'

describe('ImagesGenerationsBody', () => {
  // ---------------------------------------------------------------------------
  // gpt-image-2 — imageSize, quality, legacy size, aspectRatio
  // ---------------------------------------------------------------------------
  it('parses gpt-image-2 request (legacy size field)', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', size: '1024x1024',
    })
    expect(r.n).toBe(1)
    expect((r as any).imageSize).toBe('2K')   // default
    expect((r as any).quality).toBe('auto')   // default
  })

  it('gpt-image-2 accepts imageSize enum values and defaults to 2K', () => {
    for (const imageSize of ['auto', '1K', '2K', '4K'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'gpt-image-2', prompt: 'hi', imageSize })
      expect((r as any).imageSize).toBe(imageSize)
    }
    const def = ImagesGenerationsBody.parse({ model: 'gpt-image-2', prompt: 'hi' })
    expect((def as any).imageSize).toBe('2K')
  })

  it('gpt-image-2 accepts quality enum values and defaults to auto', () => {
    for (const quality of ['auto', 'low', 'medium', 'high'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'gpt-image-2', prompt: 'hi', quality })
      expect((r as any).quality).toBe(quality)
    }
    const def = ImagesGenerationsBody.parse({ model: 'gpt-image-2', prompt: 'hi' })
    expect((def as any).quality).toBe('auto')
  })

  it('gpt-image-2 rejects out-of-enum imageSize', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', imageSize: '8K' as any,
    })).toThrow()
  })

  it('gpt-image-2 rejects out-of-enum quality', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', quality: 'ultra' as any,
    })).toThrow()
  })

  it('rejects gpt-image-2 with invalid legacy size', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', size: '999x999' as any,
    })).toThrow()
  })

  it('gpt-image-2 accepts imageSize+aspectRatio without legacy size', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', imageSize: '4K', aspectRatio: '16:9', quality: 'high',
    })
    expect((r as any).imageSize).toBe('4K')
    expect((r as any).aspectRatio).toBe('16:9')
    expect((r as any).quality).toBe('high')
  })

  // ---------------------------------------------------------------------------
  // nano-banana-pro — imageSize enum 1K/2K/4K
  // ---------------------------------------------------------------------------
  it('parses nano-banana-pro with aspectRatio', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '16:9',
    })
    expect(r.aspectRatio).toBe('16:9')
    expect((r as any).imageSize).toBe('1K')   // default
  })

  it('nano-banana-pro accepts imageSize 1K/2K/4K and defaults to 1K', () => {
    for (const imageSize of ['1K', '2K', '4K'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '1:1', imageSize })
      expect((r as any).imageSize).toBe(imageSize)
    }
    const def = ImagesGenerationsBody.parse({ model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '1:1' })
    expect((def as any).imageSize).toBe('1K')
  })

  it('nano-banana-pro rejects imageSize 512 (only valid for nano-banana-2)', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '1:1', imageSize: '512' as any,
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // nano-banana-2 — imageSize enum 512/1K/2K/4K
  // ---------------------------------------------------------------------------
  it('nano-banana-2 accepts imageSize 512/1K/2K/4K and defaults to 1K', () => {
    for (const imageSize of ['512', '1K', '2K', '4K'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'nano-banana-2', prompt: 'hi', aspectRatio: '1:1', imageSize })
      expect((r as any).imageSize).toBe(imageSize)
    }
    const def = ImagesGenerationsBody.parse({ model: 'nano-banana-2', prompt: 'hi', aspectRatio: '1:1' })
    expect((def as any).imageSize).toBe('1K')
  })

  it('nano-banana-2 rejects out-of-enum imageSize', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'nano-banana-2', prompt: 'hi', aspectRatio: '1:1', imageSize: '8K' as any,
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // nano-banana input_assets max 3 (shared)
  // ---------------------------------------------------------------------------
  it('nano-banana-pro accepts up to 3 input_assets', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '16:9',
      input_assets: ['a', 'b', 'c'],
    })
    expect((r as any).input_assets).toHaveLength(3)
  })

  it('nano-banana-pro rejects more than 3 input_assets', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '1:1',
      input_assets: ['a', 'b', 'c', 'd'],
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // seedream-4.5 — resolution 2K/4K
  // ---------------------------------------------------------------------------
  it('seedream-4.5 accepts resolution 2K/4K and defaults to 2K', () => {
    for (const resolution of ['2K', '4K'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'seedream-4.5', prompt: 'hi', aspectRatio: '1:1', resolution })
      expect((r as any).resolution).toBe(resolution)
    }
    const def = ImagesGenerationsBody.parse({ model: 'seedream-4.5', prompt: 'hi', aspectRatio: '1:1' })
    expect((def as any).resolution).toBe('2K')
  })

  it('seedream-4.5 rejects resolution 3K (only valid for seedream-5.0)', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'seedream-4.5', prompt: 'hi', aspectRatio: '1:1', resolution: '3K' as any,
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // seedream-5.0 — resolution 2K/3K
  // ---------------------------------------------------------------------------
  it('seedream-5.0 accepts resolution 2K/3K and defaults to 2K', () => {
    for (const resolution of ['2K', '3K'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'seedream-5.0', prompt: 'hi', aspectRatio: '1:1', resolution })
      expect((r as any).resolution).toBe(resolution)
    }
    const def = ImagesGenerationsBody.parse({ model: 'seedream-5.0', prompt: 'hi', aspectRatio: '1:1' })
    expect((def as any).resolution).toBe('2K')
  })

  it('seedream-5.0 rejects resolution 4K (not in its enum — only 2K/3K)', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'seedream-5.0', prompt: 'hi', aspectRatio: '1:1', resolution: '4K' as any,
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // seedream input_assets (shared tests — pick seedream-5.0)
  // ---------------------------------------------------------------------------
  it('seedream accepts input_assets for i2i (single)', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'seedream-5.0',
      prompt: 'edit this',
      aspectRatio: '1:1',
      input_assets: ['ast_abc'],
    })
    expect(r.input_assets).toEqual(['ast_abc'])
  })

  it('seedream accepts multiple input_assets (up to 3)', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'seedream-5.0',
      prompt: 'merge these',
      aspectRatio: '16:9',
      input_assets: ['ast_1', 'ast_2', 'ast_3'],
    })
    expect(r.input_assets).toHaveLength(3)
  })

  it('seedream rejects more than 3 input_assets', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'seedream-5.0',
      prompt: 'too many',
      aspectRatio: '1:1',
      input_assets: ['a', 'b', 'c', 'd'],
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // grok-imagine — quality enum, input_assets up to 5
  // ---------------------------------------------------------------------------
  it('grok-imagine accepts quality enum quality/normal and defaults to quality', () => {
    for (const quality of ['quality', 'normal'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'grok-imagine', prompt: 'hi', aspectRatio: '1:1', quality })
      expect((r as any).quality).toBe(quality)
    }
    const def = ImagesGenerationsBody.parse({ model: 'grok-imagine', prompt: 'hi', aspectRatio: '1:1' })
    expect((def as any).quality).toBe('quality')
  })

  it('grok-imagine rejects invalid quality value', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'grok-imagine', prompt: 'hi', aspectRatio: '1:1', quality: 'ultra' as any,
    })).toThrow()
  })

  it('grok-imagine accepts input_assets up to 5', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'grok-imagine', prompt: 'hi', aspectRatio: '1:1',
      input_assets: ['a', 'b', 'c', 'd', 'e'],
    })
    expect((r as any).input_assets).toHaveLength(5)
  })

  it('grok-imagine rejects more than 5 input_assets', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'grok-imagine', prompt: 'hi', aspectRatio: '1:1',
      input_assets: ['a', 'b', 'c', 'd', 'e', 'f'],
    })).toThrow()
  })

  // ---------------------------------------------------------------------------
  // luma-uni-1 — now in images schema
  // ---------------------------------------------------------------------------
  it('luma-uni-1 parses in images schema (text-to-image)', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'luma-uni-1', prompt: 'a landscape', aspectRatio: '16:9',
    })
    expect(r.model).toBe('luma-uni-1')
    expect((r as any).aspectRatio).toBe('16:9')
    expect((r as any).input_assets).toBeUndefined()
  })

  it('luma-uni-1 accepts all 5 supported aspect ratios', () => {
    for (const ar of ['1:1', '16:9', '9:16', '3:2', '2:3'] as const) {
      const r = ImagesGenerationsBody.parse({ model: 'luma-uni-1', prompt: 'hi', aspectRatio: ar })
      expect((r as any).aspectRatio).toBe(ar)
    }
  })

  it('luma-uni-1 accepts 1 input_asset (image-ref-to-image)', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'luma-uni-1', prompt: 'edit', aspectRatio: '1:1', input_assets: ['ast_img1'],
    })
    expect((r as any).input_assets).toEqual(['ast_img1'])
  })

  it('luma-uni-1 rejects more than 1 input_asset (max 1 per plugin)', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'luma-uni-1', prompt: 'hi', aspectRatio: '1:1', input_assets: ['a', 'b'],
    })).toThrow()
  })

  it('luma-uni-1 rejects out-of-enum aspect ratio (e.g. 4:3)', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'luma-uni-1', prompt: 'hi', aspectRatio: '4:3' as any,
    })).toThrow()
  })
})
