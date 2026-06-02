import { describe, it, expect, beforeEach } from 'vitest'
import { adapterFor, resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => {
  resetAdapterCache()
  delete process.env.OPENAI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.FAL_API_KEY
  delete process.env.APIMART_API_KEY
  delete process.env.LUMA_PROXY_BEARER_TOKEN
  delete process.env.LUMA_TOKEN
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

  it('throws provider_unavailable for apimart when key missing', () => {
    expect(() => adapterFor('apimart')).toThrow(/provider apimart not configured/)
  })

  it('returns ApimartAdapter when APIMART_API_KEY present', () => {
    process.env.APIMART_API_KEY = 'sk-apimart-test'
    const a = adapterFor('apimart')
    expect(a.name).toBe('apimart')
  })

  it('luma falls back to LUMA_TOKEN when LUMA_PROXY_BEARER_TOKEN is an empty string', () => {
    // Regression: `??` would leave the empty string and break luma; `||` falls back.
    process.env.LUMA_PROXY_BEARER_TOKEN = ''
    process.env.LUMA_TOKEN = 'luma-token-xyz'
    const a = adapterFor('luma')
    expect(a.name).toBe('luma')
  })

  it('luma still unconfigured when both token vars are empty', () => {
    process.env.LUMA_PROXY_BEARER_TOKEN = ''
    process.env.LUMA_TOKEN = ''
    expect(() => adapterFor('luma')).toThrow(/provider luma not configured/)
  })
})
