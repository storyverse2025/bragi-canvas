import { describe, it, expect } from 'vitest'
import { buildApp } from '../helpers.js'

describe('POST /v1/auth/check', () => {
  it('returns ok with label for valid token', async () => {
    const res = await buildApp().request('/v1/auth/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.label).toBe('svsk-test-1')
  })

  it('returns 401 for missing token', async () => {
    const res = await buildApp().request('/v1/auth/check', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
