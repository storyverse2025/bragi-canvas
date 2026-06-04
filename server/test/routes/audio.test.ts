import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import nock from 'nock'
import { OpenAPIHono } from '@hono/zod-openapi'
import { buildApp } from '../helpers.js'
import { resetAdapterCache } from '../../src/adapters/index.js'

beforeEach(() => { resetAdapterCache() })
afterEach(() => nock.cleanAll())

function buildDocApp() {
  const app = buildApp() as OpenAPIHono
  app.doc('/v1/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Storyverse Router', version: '0.1.0' },
  })
  return app
}

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

  it('elevenlabs-music routes to elevenlabs adapter native and returns 200 bytes', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-test-key'
    const audioBytes = Buffer.from('fake-music-audio')
    nock('https://api.elevenlabs.io')
      .post('/v1/music')
      .reply(200, audioBytes, { 'Content-Type': 'audio/mpeg' })
    const res = await buildApp().request('/v1/audio/music', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'elevenlabs-music', prompt: 'upbeat jazz', duration_ms: 5000, instrumental: false }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('audio/mpeg')
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

  it('elevenlabs-sfx routes to elevenlabs adapter and returns 200 bytes', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-test-key'
    const audioBytes = Buffer.from('fake-sfx-audio')
    nock('https://api.elevenlabs.io')
      .post('/v1/sound-generation')
      .reply(200, audioBytes, { 'Content-Type': 'audio/mpeg' })
    const res = await buildApp().request('/v1/audio/sfx', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'elevenlabs-sfx', prompt: 'rain on tin roof', duration_seconds: 3 }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('audio/mpeg')
  })

  it('elevenlabs-tts-v3 routes to elevenlabs adapter and returns 200 bytes', async () => {
    process.env.ELEVENLABS_API_KEY = 'el-test-key'
    const audioBytes = Buffer.from('fake-tts-audio')
    nock('https://api.elevenlabs.io')
      .post('/v1/text-to-speech/pNInz6obpgDQGcFmaJgB')
      .query(true)
      .reply(200, audioBytes, { 'Content-Type': 'audio/mpeg' })
    const res = await buildApp().request('/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'elevenlabs-tts-v3', input: 'Hello world', voice: 'pNInz6obpgDQGcFmaJgB' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('audio/mpeg')
  })

  it('declares 200 response as audio/* in openapi doc', async () => {
    const app = buildDocApp()
    const res = await app.request('/v1/openapi.json')
    expect(res.status).toBe(200)
    const doc = await res.json() as any
    const audioSpeech200 = doc.paths['/v1/audio/speech']?.post?.responses?.['200']
    expect(audioSpeech200?.content?.['audio/mpeg']).toBeDefined()
    expect(audioSpeech200?.content?.['audio/wav']).toBeDefined()
    expect(audioSpeech200?.content?.['audio/opus']).toBeDefined()
    // 200 should not have application/json content (audio is bytes)
    expect(audioSpeech200?.content?.['application/json']).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // minimax-tts via fal — async route (202 + task_id)
  // ---------------------------------------------------------------------------

  it('minimax-tts routes to fal and returns 202 with task_id', async () => {
    process.env.FAL_API_KEY = 'fal-test-key'
    nock('https://queue.fal.run')
      .post('/fal-ai/minimax/speech-2.8-hd')
      .reply(200, {
        request_id: 'minimax-tts-route-test-req-id',
        status: 'IN_QUEUE',
      })
    const res = await buildApp().request('/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'minimax-tts',
        input: 'Hello from minimax',
        voice: 'English_Graceful_Lady',
        speed: '1.0',
      }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as any
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('fal')
    expect(body.poll_url).toContain('/v1/tasks/fal/')
  })

  // ---------------------------------------------------------------------------
  // minimax-music via fal — async route (202 + task_id)
  // ---------------------------------------------------------------------------

  it('minimax-music routes to fal and returns 202 with task_id', async () => {
    process.env.FAL_API_KEY = 'fal-test-key'
    nock('https://queue.fal.run')
      .post('/fal-ai/minimax-music/v2.6')
      .reply(200, {
        request_id: 'minimax-music-route-test-req-id',
        status: 'IN_QUEUE',
      })
    const res = await buildApp().request('/v1/audio/music', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'minimax-music',
        prompt: 'A serene instrumental track',
        instrumental: 'true',
      }),
    })
    expect(res.status).toBe(202)
    const body = await res.json() as any
    expect(body.task_id).toBeDefined()
    expect(body.provider).toBe('fal')
    expect(body.poll_url).toContain('/v1/tasks/fal/')
  })
})
