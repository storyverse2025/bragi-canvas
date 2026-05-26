import { describe, it, expect } from 'vitest'
import { lookupModel, ALL_MODEL_IDS } from '../src/registry.js'

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

  it('returns undefined for unknown model', () => {
    expect(lookupModel('does-not-exist')).toBeUndefined()
  })

  it('exports 13+ enabled model ids', () => {
    expect(ALL_MODEL_IDS.length).toBeGreaterThanOrEqual(13)
  })
})
