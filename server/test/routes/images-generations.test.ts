import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('POST /v1/images/generations', () => {
  it('routes to openai adapter and returns OpenAI image shape (sync)', async () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    nock('https://api.openai.com').post('/v1/images/generations').reply(200, {
      created: 1,
      data: [{ url: 'https://example.com/img.png' }],
    })
    const res = await buildApp().request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-image-2', prompt: 'a cat', n: 1, size: '1024x1024' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data[0].url).toContain('img.png')
  })

  it('routes to legnext adapter and returns 202 with task_id (async)', async () => {
    process.env.LEGNEXT_API_KEY = 'lgn-test'
    nock('https://api.legnext.com').post('/v1/imagine').reply(200, {
      task_id: 'task-abc-123',
      status: 'pending',
    })
    const res = await buildApp().request('/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'midjourney-v8', prompt: 'a dog', quality: 'medium' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('legnext')
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
