import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('POST /v1/videos/generations', () => {
  it('routes to fal adapter and returns 202 with task_id', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    nock('https://queue.fal.run')
      .post('/fal-ai/kling-video/v3/text-to-video')
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
})
