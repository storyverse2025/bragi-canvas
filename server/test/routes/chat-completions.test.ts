import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('POST /v1/chat/completions', () => {
  it('routes to tokenrouter adapter and returns ChatCompletion', async () => {
    process.env.TOKENROUTER_API_KEY = 'tr-test-key'
    nock('https://api.tokenrouter.com').post('/v1/chat/completions').reply(200, {
      id: 'a', object: 'chat.completion', created: 1, model: 'openai/gpt-5.5',
      choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    })
    const res = await buildApp().request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5-pro', messages: [{ role: 'user', content: 'ping' }] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.choices[0].message.content).toBe('pong')
    // response model should be our public-facing name, not the upstream model
    expect(body.model).toBe('gpt-5.5-pro')
  })

  it('rejects unknown model', async () => {
    const res = await buildApp().request('/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'no-such', messages: [] }),
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('invalid_request')
  })

  it('rejects without auth', async () => {
    const res = await buildApp().request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-5.5-pro', messages: [{ role: 'user', content: 'hi' }] }),
    })
    expect(res.status).toBe(401)
  })
})
