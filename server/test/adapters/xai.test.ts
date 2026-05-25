import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import imageFx from '../fixtures/xai/image-success.json' with { type: 'json' }
import errorFx from '../fixtures/xai/error-400.json' with { type: 'json' }
import { XAIAdapter } from '../../src/adapters/xai.js'

const BASE = 'https://api.x.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('XAIAdapter', () => {
  it('imageGeneration grok-imagine happy path returns outputs[0].url', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'a futuristic cityscape at night',
      aspectRatio: '16:9',
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.status).toBe('succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toContain('xai-image-result-abc123.png')
    expect(result.provider).toBe('xai')
    expect(result.model).toBe('grok-imagine')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('audioSpeech grok-tts happy path returns bytes Buffer', async () => {
    const fakeAudio = Buffer.from('fake-mp3-audio-bytes')

    nock(BASE)
      .post('/v1/audio/speech')
      .reply(200, fakeAudio, { 'Content-Type': 'audio/mpeg' })

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.audioSpeech!({
      model: 'grok-tts',
      input: 'Hello, world!',
      voice: 'alloy',
      response_format: 'mp3',
      speed: 1,
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.status).toBe('succeeded')
    expect(result.bytes).toBeDefined()
    expect(Buffer.isBuffer(result.bytes)).toBe(true)
    expect(result.mimeType).toBe('audio/mpeg')
    expect(result.provider).toBe('xai')
    expect(result.model).toBe('grok-tts')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(400, errorFx)

    const adapter = new XAIAdapter('xai-test-key')
    await expect(
      adapter.imageGeneration!({
        model: 'grok-imagine',
        prompt: 'bad request',
        aspectRatio: '1:1',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
