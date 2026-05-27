import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('GET /v1/tasks/:provider/:task_id', () => {
  it('returns task status from fal adapter', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    // Encode a task_id in fal format: "{modelPath}|{requestId}"
    const modelPath = 'fal-ai/kling-video/v3/text-to-video'
    const requestId = 'req-abc-123'
    const taskId = `${modelPath}|${requestId}`
    // fal status URLs use only the first two path segments (org/model), no version suffix
    const statusBase = 'fal-ai/kling-video'
    nock('https://queue.fal.run')
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, { status: 'IN_QUEUE' })
    const res = await buildApp().request(`/v1/tasks/fal/${encodeURIComponent(taskId)}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
  })

  it('rejects unknown provider with 400', async () => {
    const res = await buildApp().request('/v1/tasks/bogus-provider/some-task', {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })

  it('rejects sync-only provider openai with 400 invalid_request', async () => {
    const res = await buildApp().request('/v1/tasks/openai/some-task', {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toMatch(/sync-only/)
  })

  it('accepts xai provider for task polling (grok-video is async)', async () => {
    process.env.XAI_API_KEY = 'xai-test'
    const taskId = 'e1719105-a601-9742-84c7-test12345678'
    nock('https://api.x.ai')
      .get(`/v1/videos/${taskId}`)
      .reply(200, { status: 'pending', progress: 30 })
    const res = await buildApp().request(`/v1/tasks/xai/${taskId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
  })

  it('rejects sync-only provider tokenrouter with 400 invalid_request', async () => {
    const res = await buildApp().request('/v1/tasks/tokenrouter/some-task', {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toMatch(/sync-only/)
  })
})
