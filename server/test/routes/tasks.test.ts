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
    nock('https://queue.fal.run')
      .get(`/${modelPath}/requests/${requestId}/status`)
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
})
