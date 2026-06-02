import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { maskBragiToken, requireBragiToken } from '../src/auth.js'

const TOKENS = new Set(['svsk-good'])

function appWith() {
  const app = new Hono()
  app.use('/v1/*', requireBragiToken(TOKENS))
  app.get('/v1/ping', c => c.json({ ok: true }))
  return app
}

describe('auth middleware', () => {
  it('rejects request without Authorization header', async () => {
    const res = await appWith().request('/v1/ping')
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_token')
  })

  it('rejects malformed Authorization', async () => {
    const res = await appWith().request('/v1/ping', { headers: { Authorization: 'Token x' } })
    expect(res.status).toBe(401)
  })

  it('rejects unknown token', async () => {
    const res = await appWith().request('/v1/ping', { headers: { Authorization: 'Bearer svsk-bad' } })
    expect(res.status).toBe(401)
  })

  it('accepts known token', async () => {
    const res = await appWith().request('/v1/ping', { headers: { Authorization: 'Bearer svsk-good' } })
    expect(res.status).toBe(200)
  })
})

describe('maskBragiToken', () => {
  it('keeps the svsk-<label>- prefix and masks the secret', () => {
    expect(maskBragiToken('svsk-weichu-2e7907148c5f603f')).toBe('svsk-weichu-****')
    expect(maskBragiToken('svsk-test-1')).toBe('svsk-test-****')
  })

  it('never leaks a secret that itself contains dashes', () => {
    const masked = maskBragiToken('svsk-prod-a1b2-c3d4-e5f6')
    expect(masked).toBe('svsk-prod-****')
    // every secret segment must be gone, not just the last one
    for (const seg of ['a1b2', 'c3d4', 'e5f6']) {
      expect(masked).not.toContain(seg)
    }
  })

  it('masks everything after svsk- when there is no label/secret separator', () => {
    expect(maskBragiToken('svsk-onlyone')).toBe('svsk-****')
  })
})
