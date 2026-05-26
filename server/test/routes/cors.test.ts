import { describe, it, expect } from 'vitest'
import { buildApp } from '../helpers.js'

describe('CORS preflight', () => {
  it('OPTIONS request returns Access-Control-Allow-Origin: *', async () => {
    const res = await buildApp().request('/v1/chat/completions', {
      method: 'OPTIONS',
      headers: {
        Origin: 'app://obsidian.md',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    })
    // hono/cors returns 204 for preflight; some versions return 200 — accept either
    expect([200, 204]).toContain(res.status)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-allow-methods')).toContain('POST')
    expect(res.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization')
  })
})
