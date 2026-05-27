import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'
import { encodeTaskId } from '../../src/adapters/task-id.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('GET /v1/tasks/:provider/:task_id', () => {
  it('returns task status from fal adapter using base64url-encoded task_id', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    // Raw fal task_id contains slashes — base64url-encode it before using as path segment
    const modelPath = 'fal-ai/kling-video/v3/text-to-video'
    const requestId = 'req-abc-123'
    const rawTaskId = `${modelPath}|${requestId}`
    const encodedTaskId = encodeTaskId(rawTaskId)

    // The encoded ID must NOT contain '/' — verify the fix works
    expect(encodedTaskId).not.toContain('/')

    // fal status URLs use only the first two path segments (org/model), no version suffix
    const statusBase = 'fal-ai/kling-video'
    nock('https://queue.fal.run')
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, { status: 'IN_QUEUE' })

    // Use the encoded task_id verbatim in the URL (no extra encoding)
    const res = await buildApp().request(`/v1/tasks/fal/${encodedTaskId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
  })

  it('task_id with slashes does NOT 404 (routing fix)', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    // Simulate a fal model with a deeply nested path (lots of slashes)
    const rawTaskId = 'fal-ai/kling-video/o3/pro/reference-to-video|req-xyz-999'
    const encodedTaskId = encodeTaskId(rawTaskId)

    // Encoded ID is a single path segment with no slashes → route MUST not 404
    const statusBase = 'fal-ai/kling-video'
    const requestId = 'req-xyz-999'
    nock('https://queue.fal.run')
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, { status: 'IN_PROGRESS' })

    const res = await buildApp().request(`/v1/tasks/fal/${encodedTaskId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    // Must NOT be 404 — the handler must have run
    expect(res.status).not.toBe(404)
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
    const rawTaskId = 'e1719105-a601-9742-84c7-test12345678'
    const encodedTaskId = encodeTaskId(rawTaskId)
    nock('https://api.x.ai')
      .get(`/v1/videos/${rawTaskId}`)
      .reply(200, { status: 'pending', progress: 30 })
    const res = await buildApp().request(`/v1/tasks/xai/${encodedTaskId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
  })

  it('accepts tokenrouter provider for task polling (seedance-2.0 is async)', async () => {
    process.env.TOKENROUTER_API_KEY = 'sk-tokenrouter-test'
    const rawTaskId = 'tr-video-task-abc123'
    const encodedTaskId = encodeTaskId(rawTaskId)
    nock('https://api.tokenrouter.com')
      .get(`/v1/videos/${rawTaskId}`)
      .reply(200, { task_id: rawTaskId, status: 'running', model: 'dreamina-seedance-2-0-260128' })
    const res = await buildApp().request(`/v1/tasks/tokenrouter/${encodedTaskId}`, {
      method: 'GET',
      headers: { Authorization: 'Bearer svsk-test-1' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('running')
  })
})
