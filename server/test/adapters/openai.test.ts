import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import chatFx from '../fixtures/openai/chat-success.json' with { type: 'json' }
import imgFx from '../fixtures/openai/image-success.json' with { type: 'json' }
import { OpenAIAdapter } from '../../src/adapters/openai.js'

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test'
})
afterEach(() => nock.cleanAll())

describe('OpenAI adapter', () => {
  it('chatCompletion maps OpenAI ChatCompletion shape correctly', async () => {
    nock('https://api.openai.com').post('/v1/chat/completions').reply(200, chatFx)
    const a = new OpenAIAdapter('sk-test')
    const r = await a.chatCompletion!({
      model: 'gpt-5.4-pro',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(r.status).toBe('succeeded')
    expect(r.outputs[0].text).toBe('hi back')
    expect(r.provider).toBe('openai')
  })

  it('imageGeneration maps OpenAI Images shape correctly', async () => {
    nock('https://api.openai.com').post('/v1/images/generations').reply(200, imgFx)
    const a = new OpenAIAdapter('sk-test')
    const r = await a.imageGeneration!({
      model: 'gpt-image-2', prompt: 'cat', n: 1, size: '1024x1024',
    })
    if (r.status !== 'succeeded') throw new Error('expected succeeded')
    expect(r.outputs[0].url).toContain('img1.png')
  })

  it('maps 4xx to provider_invalid_request', async () => {
    nock('https://api.openai.com').post('/v1/chat/completions').reply(400, { error: { message: 'bad', type: 'invalid_request_error' } })
    const a = new OpenAIAdapter('sk-test')
    await expect(a.chatCompletion!({
      model: 'gpt-5.4-pro', messages: [{ role: 'user', content: 'x' }],
    })).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })

  it('maps 5xx to provider_unavailable', async () => {
    nock('https://api.openai.com').post('/v1/chat/completions').reply(503, 'down')
    const a = new OpenAIAdapter('sk-test')
    await expect(a.chatCompletion!({
      model: 'gpt-5.4-pro', messages: [{ role: 'user', content: 'x' }],
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
