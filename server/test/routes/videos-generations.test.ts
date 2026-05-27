import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('POST /v1/videos/generations', () => {
  it('routes to fal adapter and returns 202 with task_id', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    nock('https://queue.fal.run')
      .post('/fal-ai/kling-video/o3/pro/reference-to-video')
      .reply(200, { request_id: 'req-xyz-999' })
    const res = await buildApp().request('/v1/videos/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kling-3.0', prompt: 'a rocket launch', duration: '5', aspectRatio: '16:9' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('fal')
    expect(body.poll_after_ms).toBeDefined()
  })

  it('rejects unknown model with 400', async () => {
    const res = await buildApp().request('/v1/videos/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'no-such', prompt: 'test' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })

  it('returns 400 (not 500) for missing input_assets (P2.5 regression)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'router-vid-'))
    process.env.ASSET_TMP_DIR = dir
    process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.ROUTER_PUBLIC_URL = 'https://router.test'
    process.env.FAL_API_KEY = 'test'
    const res = await buildApp().request('/v1/videos/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kling-3.0', prompt: 'x', aspectRatio: '9:16', duration: '5', input_assets: ['ast_missing'] }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })
})
