import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import videoSubmitFx from '../fixtures/fal/video-submit.json' with { type: 'json' }
import grokVideoSubmitFx from '../fixtures/fal/grok-video-submit.json' with { type: 'json' }
import audioMusicSubmitFx from '../fixtures/fal/audio-music-submit.json' with { type: 'json' }
import nanoBananaSubmitFx from '../fixtures/fal/nano-banana-submit.json' with { type: 'json' }
import taskInQueueFx from '../fixtures/fal/task-status-in-queue.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/fal/task-status-completed.json' with { type: 'json' }
import videoResultFx from '../fixtures/fal/video-result.json' with { type: 'json' }
import { FalAdapter } from '../../src/adapters/fal.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://queue.fal.run'
// kling 2.6 and 3.0 both use o3/pro/reference-to-video
const KLING_O3_PATH = '/fal-ai/kling-video/o3/pro/reference-to-video'
const GROK_VIDEO_PATH = '/xai/grok-imagine-video/image-to-video'
const MUSIC_PATH = '/fal-ai/elevenlabs/music'
const NANO_BANANA_2_PATH = '/fal-ai/nano-banana-2'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-fal-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'asset_abc123', Buffer.from('IMGDATA'), 'image/png')
})

afterEach(() => {
  nock.cleanAll()
})

describe('FalAdapter', () => {
  it('videoGeneration kling-3.0 uses o3/pro/reference-to-video path', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-3.0',
      prompt: 'a cinematic sunset over the ocean',
      duration: '5',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain('|')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('videoGeneration kling-2.6 also uses o3/pro/reference-to-video path', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-2.6',
      prompt: 'a cinematic sunset',
      duration: '5',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
  })

  it('videoGeneration grok-video uses xai/grok-imagine-video/image-to-video path', async () => {
    nock(BASE)
      .post(GROK_VIDEO_PATH)
      .reply(200, grokVideoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a futuristic city with flying cars',
      duration: '6',
      input_assets: ['asset_abc123'],
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(grokVideoSubmitFx.request_id)
  })

  it('audioMusic elevenlabs-music returns AsyncResult', async () => {
    nock(BASE)
      .post(MUSIC_PATH)
      .reply(200, audioMusicSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.audioMusic!({
      model: 'elevenlabs-music',
      prompt: 'an uplifting orchestral piece',
      duration_ms: 30000,
      instrumental: true,
    })

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(audioMusicSubmitFx.request_id)
  })

  it('imageGeneration nano-banana-2 T2I returns AsyncResult', async () => {
    nock(BASE)
      .post(NANO_BANANA_2_PATH)
      .reply(200, nanoBananaSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.imageGeneration!({
      model: 'nano-banana-2',
      prompt: 'a beautiful sunset',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(nanoBananaSubmitFx.request_id)
  })

  it('taskStatus returns running for IN_QUEUE status', async () => {
    const modelPath = 'fal-ai/kling-video/o3/pro/reference-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`
    const statusBase = 'fal-ai/kling-video'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskInQueueFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with video output when COMPLETED', async () => {
    const modelPath = 'fal-ai/kling-video/o3/pro/reference-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`
    const statusBase = 'fal-ai/kling-video'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskCompletedFx)

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}`)
      .reply(200, videoResultFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('kling-result-abc123.mp4')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(400, { detail: 'Invalid request: prompt is too long' })

    const adapter = new FalAdapter('fal-test-key')
    await expect(
      adapter.videoGeneration!({
        model: 'kling-3.0',
        prompt: 'bad request',
        duration: '5',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
