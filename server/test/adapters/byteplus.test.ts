import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import imgFx from '../fixtures/byteplus/image-success.json' with { type: 'json' }
import videoCreatedFx from '../fixtures/byteplus/video-task-created.json' with { type: 'json' }
import videoSucceededFx from '../fixtures/byteplus/video-task-succeeded.json' with { type: 'json' }
import errorFx from '../fixtures/byteplus/error-400.json' with { type: 'json' }
import { ByteplusAdapter, aspectRatioToSeeadreamSize } from '../../src/adapters/byteplus.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://ark.cn-beijing.volces.com'

const config = {
  apiKey: 'ark-test-key',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  project: 'test-project',
}

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-byteplus-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_img1', Buffer.from('IMGDATA1'), 'image/png')
  await storeAsset(dir, 'ast_img2', Buffer.from('IMGDATA2'), 'image/png')
  await storeAsset(dir, 'ast_vid1', Buffer.from('VIDDATA'), 'video/mp4')
})

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

  it('imageGeneration with single input_asset sends image as signed URL (not base64)', async () => {
    // Volcengine seedream requires a fetchable URL, not raw base64 (bug confirmed 2026-05-27)
    let capturedBody: any
    nock(BASE)
      .post('/api/v3/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, imgFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.imageGeneration!({
      model: 'seedream-5.0',
      prompt: 'make it better',
      aspectRatio: '1:1',
      n: 1,
      input_assets: ['ast_img1'],
    })

    expect(result.status).toBe('succeeded')
    expect(typeof capturedBody.image).toBe('string')
    // Should be a signed https URL, not raw base64
    expect(capturedBody.image).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1\?expires=/)
    expect(capturedBody.image).not.toBe(Buffer.from('IMGDATA1').toString('base64'))
  })

  it('imageGeneration with two input_assets sends image as signed URL array', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/api/v3/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, imgFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.imageGeneration!({
      model: 'seedream-5.0',
      prompt: 'merge these',
      aspectRatio: '16:9',
      n: 1,
      input_assets: ['ast_img1', 'ast_img2'],
    })

    expect(result.status).toBe('succeeded')
    expect(Array.isArray(capturedBody.image)).toBe(true)
    expect(capturedBody.image[0]).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1\?expires=/)
    expect(capturedBody.image[1]).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img2\?expires=/)
  })

  it('imageGeneration passes n from request to upstream — not hardcoded', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/api/v3/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, imgFx)

    const adapter = new ByteplusAdapter(config)
    await adapter.imageGeneration!({
      model: 'seedream-5.0',
      prompt: 'four variations',
      aspectRatio: '1:1',
      n: 4,
    })

    expect(capturedBody.n).toBe(4)
  })

  it('videoGeneration v2v: video asset produces video_url/reference_video entry (no image_url)', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/api/v3/contents/generations/tasks', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new ByteplusAdapter(config)
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'video to video',
      ratio: '16:9',
      duration: '5',
      generate_audio: true,
      resolution: '720p',
      input_assets: ['ast_vid1'],
    })

    const contentArr: Array<Record<string, unknown>> = capturedBody.content
    const videoEntry = contentArr.find((e) => e.type === 'video_url')
    const imageEntry = contentArr.find((e) => e.type === 'image_url')
    expect(videoEntry).toBeDefined()
    expect((videoEntry as any).video_url.url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_vid1\?expires=/)
    expect((videoEntry as any).role).toBe('reference_video')
    expect(imageEntry).toBeUndefined()
  })

  it('videoGeneration forwards resolution in body', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/api/v3/contents/generations/tasks', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new ByteplusAdapter(config)
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'hi-res clip',
      ratio: '16:9',
      duration: '5',
      generate_audio: true,
      resolution: '1080p',
    })

    expect(capturedBody.resolution).toBe('1080p')
  })
})
