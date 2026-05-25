import { describe, it, expect, beforeEach } from 'vitest'
import { adapterFor, resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => {
  resetAdapterCache()
  delete process.env.OPENAI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.FAL_API_KEY
})

describe('adapterFor', () => {
  it('throws provider_unavailable when key missing', () => {
    expect(() => adapterFor('openai')).toThrow(/provider openai not configured/)
  })

  it('returns OpenAI adapter when key present', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    const a = adapterFor('openai')
    expect(a.name).toBe('openai')
  })

  it('caches adapters across calls', () => {
    process.env.GEMINI_API_KEY = 'g-test'
    const a1 = adapterFor('gemini')
    const a2 = adapterFor('gemini')
    expect(a1).toBe(a2)
  })

  it('throws with correct ApiError code', () => {
    try {
      adapterFor('fal')
    } catch (e: any) {
      expect(e.code).toBe('provider_unavailable')
      expect(e.httpStatus).toBe(503)
    }
  })
})
