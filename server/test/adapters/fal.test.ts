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
import minimaxTtsSubmitFx from '../fixtures/fal/minimax-tts-submit.json' with { type: 'json' }
import minimaxMusicSubmitFx from '../fixtures/fal/minimax-music-submit.json' with { type: 'json' }
import minimaxAudioResultFx from '../fixtures/fal/minimax-audio-result.json' with { type: 'json' }
import { FalAdapter } from '../../src/adapters/fal.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://queue.fal.run'
// kling 2.6 and 3.0 both use o3/pro/reference-to-video
const KLING_O3_PATH = '/fal-ai/kling-video/o3/pro/reference-to-video'
const GROK_VIDEO_PATH = '/xai/grok-imagine-video/image-to-video'
const MUSIC_PATH = '/fal-ai/elevenlabs/music'
const NANO_BANANA_2_PATH = '/fal-ai/nano-banana-2'
const MINIMAX_TTS_PATH = '/fal-ai/minimax/speech-2.8-hd'
const MINIMAX_MUSIC_PATH = '/fal-ai/minimax-music/v2.6'

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

  // ---------------------------------------------------------------------------
  // kling mode (std/pro) — fal adapter always uses the pro endpoint path
  // ASSUMPTION: mode is a no-op for fal (plugin hardcodes fal apiModelId to pro);
  // std/pro distinction applies to the kling native provider, not fal.
  // ---------------------------------------------------------------------------

  it('videoGeneration kling-3.0 mode=pro uses same o3/pro path', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-3.0',
      prompt: 'a cinematic sunset',
      duration: '5',
      aspectRatio: '16:9',
      mode: 'pro',
    } as any)

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
    // The nock matched, confirming the pro path was used
  })

  it('videoGeneration kling-3.0 mode=std still uses o3/pro path (no-op on fal)', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-3.0',
      prompt: 'a cinematic sunset',
      duration: '5',
      aspectRatio: '16:9',
      mode: 'std',
    } as any)

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
    // Nock matched o3/pro path — confirms mode=std is a no-op on fal
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

  it('network failure on videoGeneration maps to provider_unavailable 503', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .replyWithError('ECONNREFUSED')

    const adapter = new FalAdapter('fal-test-key')
    await expect(
      adapter.videoGeneration!({
        model: 'kling-3.0',
        prompt: 'test video',
        duration: '5',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })

  // ---------------------------------------------------------------------------
  // minimax-tts via fal (async queue)
  // ---------------------------------------------------------------------------

  it('audioSpeech minimax-tts submits to fal-ai/minimax/speech-2.8-hd and returns AsyncResult', async () => {
    let capturedBody: any
    nock(BASE)
      .post(MINIMAX_TTS_PATH, (body) => { capturedBody = body; return true })
      .reply(200, minimaxTtsSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.audioSpeech!({
      model: 'minimax-tts',
      input: 'Hello world',
      voice: 'English_Graceful_Lady',
      speed: '1.0',
    } as any)

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(minimaxTtsSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
    // voice_id and speed forwarded to the fal body
    expect(capturedBody.voice_id).toBe('English_Graceful_Lady')
    expect(capturedBody.speed).toBe(1.0)
    expect(capturedBody.text).toBe('Hello world')
  })

  it('audioSpeech minimax-tts forwards non-default voice and speed', async () => {
    let capturedBody: any
    nock(BASE)
      .post(MINIMAX_TTS_PATH, (body) => { capturedBody = body; return true })
      .reply(200, minimaxTtsSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    await adapter.audioSpeech!({
      model: 'minimax-tts',
      input: 'Ni hao',
      voice: 'Chinese (Mandarin)_Gentleman',
      speed: '0.75',
    } as any)

    expect(capturedBody.voice_id).toBe('Chinese (Mandarin)_Gentleman')
    expect(capturedBody.speed).toBe(0.75)
  })

  it('taskStatus returns succeeded with audio output when COMPLETED (minimax-tts)', async () => {
    const modelPath = 'fal-ai/minimax/speech-2.8-hd'
    const requestId = minimaxTtsSubmitFx.request_id
    const taskId = `${modelPath}|${requestId}`
    // taskStatus uses the first two path segments for status base
    const statusBase = 'fal-ai/minimax'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskCompletedFx)

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}`)
      .reply(200, minimaxAudioResultFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs![0].kind).toBe('audio')
    expect(result.outputs![0].url).toContain('minimax-audio-result-abc123.mp3')
  })

  // ---------------------------------------------------------------------------
  // minimax-music via fal (async queue)
  // ---------------------------------------------------------------------------

  it('audioMusic minimax-music submits to fal-ai/minimax-music/v2.6 and returns AsyncResult', async () => {
    let capturedBody: any
    nock(BASE)
      .post(MINIMAX_MUSIC_PATH, (body) => { capturedBody = body; return true })
      .reply(200, minimaxMusicSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.audioMusic!({
      model: 'minimax-music',
      prompt: 'A calm ambient instrumental track',
      instrumental: 'true',
    } as any)

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(minimaxMusicSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
    // instrumental string 'true' converted to boolean true
    expect(capturedBody.instrumental).toBe(true)
    expect(capturedBody.prompt).toBe('A calm ambient instrumental track')
  })

  it('audioMusic minimax-music instrumental=false forwards boolean false', async () => {
    let capturedBody: any
    nock(BASE)
      .post(MINIMAX_MUSIC_PATH, (body) => { capturedBody = body; return true })
      .reply(200, minimaxMusicSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    await adapter.audioMusic!({
      model: 'minimax-music',
      prompt: 'A pop song with lyrics',
      instrumental: 'false',
    } as any)

    expect(capturedBody.instrumental).toBe(false)
  })

  it('taskStatus returns succeeded with audio output when COMPLETED (minimax-music)', async () => {
    const modelPath = 'fal-ai/minimax-music/v2.6'
    const requestId = minimaxMusicSubmitFx.request_id
    const taskId = `${modelPath}|${requestId}`
    // taskStatus uses first two path segments: 'fal-ai/minimax-music'
    const statusBase = 'fal-ai/minimax-music'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskCompletedFx)

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}`)
      .reply(200, minimaxAudioResultFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs![0].kind).toBe('audio')
    expect(result.outputs![0].url).toContain('minimax-audio-result-abc123.mp3')
  })
})
