import { describe, it, expect } from 'vitest'
import { buildApp } from '../helpers.js'

describe('GET /v1/health', () => {
  it('returns ok with version and uptime', async () => {
    const app = buildApp()
    const res = await app.request('/v1/health')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.version).toBe('string')
    expect(typeof body.uptime_sec).toBe('number')
  })
})
