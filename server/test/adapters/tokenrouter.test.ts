import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import chatFx from '../fixtures/tokenrouter/chat-success.json' with { type: 'json' }
import errorFx from '../fixtures/tokenrouter/error-400.json' with { type: 'json' }
import { TokenrouterAdapter } from '../../src/adapters/tokenrouter.js'

const BASE = 'https://api.tokenrouter.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('TokenrouterAdapter', () => {
  it('chatCompletion qwen-3-6-plus happy path returns text output', async () => {
    nock(BASE)
      .post('/v1/chat/completions')
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'qwen-3-6-plus',
      messages: [
        { role: 'user', content: 'Hello, who are you?' },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('text')
    expect(result.outputs[0].text).toContain('Qwen')
    expect(result.provider).toBe('tokenrouter')
    expect(result.model).toBe('qwen-3-6-plus')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/chat/completions')
      .reply(401, errorFx)

    const adapter = new TokenrouterAdapter('sk-bad-key')
    await expect(
      adapter.chatCompletion!({
        model: 'qwen-3-6-plus',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
