import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import imageFx from '../fixtures/xai/image-success.json' with { type: 'json' }
import videoSubmitFx from '../fixtures/xai/video-submit.json' with { type: 'json' }
import videoPendingFx from '../fixtures/xai/video-pending.json' with { type: 'json' }
import videoSucceededFx from '../fixtures/xai/video-succeeded.json' with { type: 'json' }
import errorFx from '../fixtures/xai/error-400.json' with { type: 'json' }
import { XAIAdapter } from '../../src/adapters/xai.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://api.x.ai'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-xai-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_img1', Buffer.from('IMGDATA'), 'image/png')
})

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

  it('videoGeneration grok-video happy path returns AsyncResult with request_id', async () => {
    nock(BASE)
      .post('/v1/videos/generations')
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a cat running in the park',
      input_assets: ['ast_img1'],
      duration: '6',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('xai')
    expect(result.provider_task_id).toBe('e1719105-a601-9742-84c7-test12345678')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for pending xai video returns running', async () => {
    const taskId = 'e1719105-a601-9742-84c7-test12345678'
    nock(BASE)
      .get(`/v1/videos/${taskId}`)
      .reply(200, videoPendingFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for succeeded xai video returns outputs with video url', async () => {
    const taskId = 'e1719105-a601-9742-84c7-test12345678'
    nock(BASE)
      .get(`/v1/videos/${taskId}`)
      .reply(200, videoSucceededFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('xai-video-result-abc123.mp4')
  })

  it('videoGeneration missing request_id in response throws provider_unavailable', async () => {
    nock(BASE)
      .post('/v1/videos/generations')
      .reply(200, {})  // no request_id

    const adapter = new XAIAdapter('xai-test-key')
    await expect(
      adapter.videoGeneration!({
        model: 'grok-video',
        prompt: 'test',
        input_assets: ['ast_img1'],
        duration: '6',
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})
