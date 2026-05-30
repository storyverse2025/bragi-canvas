import { describe, it, expect } from 'vitest'
import { buildApp } from '../helpers.js'

describe('POST /v1/auth/check', () => {
  it('returns ok without echoing the token for valid token', async () => {
    const res = await buildApp().request('/v1/auth/check', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body).not.toHaveProperty('label')
    expect(JSON.stringify(body)).not.toContain('svsk-test-1')
  })

  it('returns 401 for missing token', async () => {
    const res = await buildApp().request('/v1/auth/check', { method: 'POST' })
    expect(res.status).toBe(401)
  })
})
