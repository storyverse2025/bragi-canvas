import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import imgFx from '../fixtures/byteplus/image-success.json' with { type: 'json' }
import videoCreatedFx from '../fixtures/byteplus/video-task-created.json' with { type: 'json' }
import videoSucceededFx from '../fixtures/byteplus/video-task-succeeded.json' with { type: 'json' }
import errorFx from '../fixtures/byteplus/error-400.json' with { type: 'json' }
import { ByteplusAdapter, aspectRatioToSeeadreamSize } from '../../src/adapters/byteplus.js'

const BASE = 'https://ark.cn-beijing.volces.com'

const config = {
  apiKey: 'ark-test-key',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  project: 'test-project',
}

afterEach(() => {
  nock.cleanAll()
})

describe('aspectRatioToSeeadreamSize', () => {
  it('1:1 produces square at or above 3686400 pixels, multiple of 64', () => {
    const size = aspectRatioToSeeadreamSize('1:1')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBe(h)
    expect(w * h).toBeGreaterThanOrEqual(3_686_400)
    expect(w % 64).toBe(0)
    expect(h % 64).toBe(0)
  })

  it('16:9 produces landscape at or above 3686400 pixels', () => {
    const size = aspectRatioToSeeadreamSize('16:9')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBeGreaterThan(h)
    expect(w * h).toBeGreaterThanOrEqual(3_686_400)
  })

  it('9:16 produces portrait', () => {
    const size = aspectRatioToSeeadreamSize('9:16')
    const [w, h] = size.split('x').map(Number)
    expect(h).toBeGreaterThan(w)
  })

  it('invalid ratio falls back to 16:9 shape', () => {
    const size = aspectRatioToSeeadreamSize('bad:ratio')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBeGreaterThan(h)
  })
})

describe('ByteplusAdapter', () => {
  it('imageGeneration happy path (seedream-4.5) returns outputs[0].url', async () => {
    nock(BASE)
      .post('/api/v3/images/generations')
      .reply(200, imgFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.imageGeneration!({
      model: 'seedream-4.5',
      prompt: 'a beautiful sunset',
      aspectRatio: '1:1',
      n: 1,
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toContain('seedream-result-abc123.png')
    expect(result.provider).toBe('byteplus')
    expect(result.model).toBe('seedream-4.5')
  })

  it('videoGeneration happy path (seedance-2.0) returns AsyncResult with provider_task_id', async () => {
    nock(BASE)
      .post('/api/v3/contents/generations/tasks')
      .reply(200, videoCreatedFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'a drone flying over a city',
      ratio: '16:9',
      duration: '5',
      resolution: '1080p',
      generate_audio: true,
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('byteplus')
    expect(result.provider_task_id).toBe('task-seedance-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for completed task returns succeeded with video output', async () => {
    nock(BASE)
      .get('/api/v3/contents/generations/tasks/task-seedance-abc123')
      .reply(200, videoSucceededFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.taskStatus!('task-seedance-abc123')

    expect(result.status).toBe('succeeded')
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('seedance-result-abc123.mp4')
  })

  it('taskStatus maps sensitive content error code to provider_rejected', async () => {
    nock(BASE)
      .get('/api/v3/contents/generations/tasks/task-fail-123')
      .reply(200, {
        id: 'task-fail-123',
        status: 'failed',
        error: { code: 'SensitiveContentDetected', message: 'content policy' },
      })

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.taskStatus!('task-fail-123')

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('provider_rejected')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/api/v3/images/generations')
      .reply(400, errorFx)

    const adapter = new ByteplusAdapter(config)
    await expect(
      adapter.imageGeneration!({
        model: 'seedream-4.5',
        prompt: 'bad request',
        aspectRatio: '1:1',
        n: 1,
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
