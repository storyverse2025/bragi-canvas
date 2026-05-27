import { describe, it, expect } from 'vitest'
import { ImagesGenerationsBody } from '../../src/schemas/images-generations.js'

describe('ImagesGenerationsBody', () => {
  it('parses gpt-image-2 request', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', size: '1024x1024',
    })
    expect(r.n).toBe(1)
  })
  it('parses nano-banana with aspectRatio', () => {
    const r = ImagesGenerationsBody.parse({
      model: 'nano-banana-pro', prompt: 'hi', aspectRatio: '16:9',
    })
    expect(r.aspectRatio).toBe('16:9')
  })
  it('rejects gpt-image-2 with invalid size', () => {
    expect(() => ImagesGenerationsBody.parse({
      model: 'gpt-image-2', prompt: 'hi', size: '999x999' as any,
    })).toThrow()
  })
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
})
