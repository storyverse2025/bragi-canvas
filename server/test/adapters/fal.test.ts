import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import videoSubmitFx from '../fixtures/fal/video-submit.json' with { type: 'json' }
import grokVideoSubmitFx from '../fixtures/fal/grok-video-submit.json' with { type: 'json' }
import audioMusicSubmitFx from '../fixtures/fal/audio-music-submit.json' with { type: 'json' }
import taskInQueueFx from '../fixtures/fal/task-status-in-queue.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/fal/task-status-completed.json' with { type: 'json' }
import videoResultFx from '../fixtures/fal/video-result.json' with { type: 'json' }
import { FalAdapter } from '../../src/adapters/fal.js'

const BASE = 'https://queue.fal.run'
const KLING_V3_PATH = '/fal-ai/kling-video/v3/text-to-video'
const GROK_VIDEO_PATH = '/fal-ai/grok-video'
const MUSIC_PATH = '/fal-ai/elevenlabs/music'

afterEach(() => {
  nock.cleanAll()
})

describe('FalAdapter', () => {
  it('videoGeneration kling-3.0 returns AsyncResult with encoded provider_task_id', async () => {
    nock(BASE)
      .post(KLING_V3_PATH)
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
    // provider_task_id encodes model path + request_id with | separator
    expect(result.provider_task_id).toContain('|')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('videoGeneration grok-video happy path returns AsyncResult', async () => {
    nock(BASE)
      .post(GROK_VIDEO_PATH)
      .reply(200, grokVideoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a futuristic city with flying cars',
      duration: '6',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(grokVideoSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
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
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(audioMusicSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns running for IN_QUEUE status', async () => {
    const modelPath = 'fal-ai/kling-video/v3/text-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`

    nock(BASE)
      .get(`/${modelPath}/requests/${requestId}/status`)
      .reply(200, taskInQueueFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with video output when COMPLETED', async () => {
    const modelPath = 'fal-ai/kling-video/v3/text-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`

    nock(BASE)
      .get(`/${modelPath}/requests/${requestId}/status`)
      .reply(200, taskCompletedFx)

    nock(BASE)
      .get(`/${modelPath}/requests/${requestId}`)
      .reply(200, videoResultFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('kling-result-abc123.mp4')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post(KLING_V3_PATH)
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
