import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => {
  resetAdapterCache()
  delete process.env.OPENAI_API_KEY
  delete process.env.APIMART_API_KEY
  delete process.env.LEGNEXT_API_KEY
})
afterEach(() => nock.cleanAll())

describe('POST /v1/images/generations', () => {
  it('routes to apimart adapter and returns 202 with task_id (async, gpt-image-2)', async () => {
    process.env.APIMART_API_KEY = 'sk-apimart-test'
    nock('https://api.apimart.ai').post('/v1/images/generations').reply(200, {
      data: [{ task_id: 'task-apimart-123', status: 'pending' }],
    })
    const res = await buildApp().request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'a cat', n: 1, size: '1024x1024' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('apimart')
  })

  it('routes to legnext adapter and midjourney returns 501 (not supported in V1)', async () => {
    process.env.LEGNEXT_API_KEY = 'lgn-test'
    const res = await buildApp().request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'midjourney-v8', prompt: 'a dog', quality: 'medium' }),
    })
    expect(res.status).toBe(501)
  })

  it('rejects unknown model with 400', async () => {
    const res = await buildApp().request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'no-such', prompt: 'test' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })
})
