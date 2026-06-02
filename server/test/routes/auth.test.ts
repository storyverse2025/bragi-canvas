import { describe, it, expect } from 'vitest'
import { buildApp } from '../helpers.js'

describe('POST /v1/auth/check', () => {
  it('returns ok with a MASKED label for valid token (never echoes the full secret)', async () => {
    const res = await buildApp().request('/v1/auth/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    // identifying prefix kept, secret suffix masked
    expect(body.label).toBe('svsk-test-****')
    // the raw token must never appear in the response
    expect(body.label).not.toBe('svsk-test-1')
  })

  it('returns 401 for missing token', async () => {
    const res = await buildApp().request('/v1/auth/check', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
