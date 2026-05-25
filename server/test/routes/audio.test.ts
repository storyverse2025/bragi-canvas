import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

describe('POST /v1/audio/speech', () => {
  it('routes to xai adapter and returns audio bytes', async () => {
    process.env.XAI_API_KEY = 'xai-test'
    const audioBytes = Buffer.from('fake-audio-data')
    nock('https://api.x.ai')
      .post('/v1/audio/speech')
      .reply(200, audioBytes, { 'Content-Type': 'audio/mpeg' })
    const res = await buildApp().request('/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'grok-tts', input: 'Hello world', voice: 'alloy' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('audio/mpeg')
  })

  it('routes to fal adapter for elevenlabs-music and returns 202', async () => {
    process.env.FAL_API_KEY = 'fal-test'
    nock('https://queue.fal.run')
      .post('/fal-ai/elevenlabs/music')
      .reply(200, { request_id: 'music-req-123' })
    const res = await buildApp().request('/v1/audio/music', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'elevenlabs-music', prompt: 'upbeat jazz' }),
    })
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('fal')
  })

  it('rejects unknown model with 400', async () => {
    const res = await buildApp().request('/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'no-such', input: 'test', voice: 'alloy' }),
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })
})
