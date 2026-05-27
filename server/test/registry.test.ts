import { describe, it, expect } from 'vitest'
import { lookupModel, resolveProvider, ALL_MODEL_IDS } from '../src/registry.js'

describe('registry', () => {
  it('looks up gpt-image-2 → apimart/image/async', () => {
    const r = lookupModel('gpt-image-2')
    expect(r).toEqual({ provider: 'apimart', capability: 'image', async: true })
  })

  it('looks up kling-3.0 → fal/video/async', () => {
    const r = lookupModel('kling-3.0')
    expect(r).toEqual({ provider: 'fal', capability: 'video', async: true })
  })

  it('looks up gpt-5.4-pro → tokenrouter/text/sync', () => {
    const r = lookupModel('gpt-5.4-pro')
    expect(r).toEqual({ provider: 'tokenrouter', capability: 'text', async: false })
  })

  it('looks up gemini-3-flash → tokenrouter/text/sync', () => {
    const r = lookupModel('gemini-3-flash')
    expect(r).toEqual({ provider: 'tokenrouter', capability: 'text', async: false })
  })

  it('looks up nano-banana-pro → fal/image/async', () => {
    const r = lookupModel('nano-banana-pro')
    expect(r).toEqual({ provider: 'fal', capability: 'image', async: true })
  })

  it('looks up grok-video → xai/video/async (native xAI video API)', () => {
    const r = lookupModel('grok-video')
    expect(r).toEqual({ provider: 'xai', capability: 'video', async: true })
  })

  it('returns undefined for unknown model', () => {
    expect(lookupModel('does-not-exist')).toBeUndefined()
  })

  it('exports 13+ enabled model ids', () => {
    expect(ALL_MODEL_IDS.length).toBeGreaterThanOrEqual(13)
  })
})

describe('resolveProvider', () => {
  it('no override returns default provider from registry', () => {
    const { entry, provider } = resolveProvider('grok-video')
    expect(provider).toBe('xai')
    expect(entry.capability).toBe('video')
  })

  it('valid override returns requested provider', () => {
    const { provider } = resolveProvider('kling-3.0', 'fal')
    expect(provider).toBe('fal')
  })

  it('invalid override throws 400 with options listed', () => {
    expect(() => resolveProvider('kling-3.0', 'byteplus')).toThrow(
      expect.objectContaining({ code: 'invalid_request', httpStatus: 400 })
    )
  })

  it('invalid override error message includes valid options', () => {
    try {
      resolveProvider('kling-3.0', 'byteplus')
      throw new Error('expected to throw')
    } catch (e: any) {
      expect(e.message).toContain('fal')
      expect(e.message).toContain('byteplus')
    }
  })

  it('unknown model throws unknown_model error', () => {
    expect(() => resolveProvider('no-such-model')).toThrow(
      expect.objectContaining({ code: 'unknown_model' })
    )
  })

  it('override to same as default succeeds', () => {
    const { provider } = resolveProvider('gpt-image-2', 'apimart')
    expect(provider).toBe('apimart')
  })
})
