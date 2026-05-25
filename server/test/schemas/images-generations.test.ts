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
})
