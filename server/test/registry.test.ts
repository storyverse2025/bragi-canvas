import { describe, it, expect } from 'vitest'
import { lookupModel, ALL_MODEL_IDS } from '../src/registry.js'

describe('registry', () => {
  it('looks up gpt-image-2 → openai/image/sync', () => {
    const r = lookupModel('gpt-image-2')
    expect(r).toEqual({ provider: 'openai', capability: 'image', async: false })
  })

  it('looks up kling-3.0 → fal/video/async', () => {
    const r = lookupModel('kling-3.0')
    expect(r).toEqual({ provider: 'fal', capability: 'video', async: true })
  })

  it('returns undefined for unknown model', () => {
    expect(lookupModel('does-not-exist')).toBeUndefined()
  })

  it('exports 13+ enabled model ids', () => {
    expect(ALL_MODEL_IDS.length).toBeGreaterThanOrEqual(13)
  })
})
