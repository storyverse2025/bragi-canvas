import { describe, it, expect } from 'vitest'
import { Hono } from 'hono'
import { requireBragiToken } from '../src/auth.js'

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
