import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import errorFx from '../fixtures/luma/error-400.json' with { type: 'json' }
import videoSubmitFx from '../fixtures/luma/video-submit.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/luma/task-completed.json' with { type: 'json' }
import { LumaAdapter } from '../../src/adapters/luma.js'

const PROXY_BASE = 'https://luma.bragi.now'
const VIDEO_BASE = 'https://api.lumalabs.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('LumaAdapter — image (proxy)', () => {
  it('imageGeneration T2I returns SyncResult with image URL', async () => {
    nock(PROXY_BASE)
      .post('/v1/images/generate')
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-abc123.png' })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'a beautiful landscape',
      aspectRatio: '16:9',
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toContain('img-abc123.png')
    expect(result.provider).toBe('luma')
  })

  it('imageGeneration sends correct endpoint for T2I', async () => {
    let capturedPath: string | undefined
    nock(PROXY_BASE)
      .post('/v1/images/generate')
      .reply(200, (_uri: string, _body: unknown) => {
        capturedPath = '/v1/images/generate'
        return { image_url: 'https://luma.bragi.now/output/img-t2i.png' }
      })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'a red apple',
      aspectRatio: '1:1',
    })

    expect(capturedPath).toBe('/v1/images/generate')
  })

  it('prompt longer than 6000 chars gets truncated', async () => {
    let capturedBody: any = null
    nock(PROXY_BASE)
      .post('/v1/images/generate', (body) => { capturedBody = body; return true })
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-truncated.png' })

    const longPrompt = 'a'.repeat(7000)
    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: longPrompt,
      aspectRatio: '16:9',
    })

    expect(capturedBody.prompt.length).toBeLessThanOrEqual(6000)
    expect(capturedBody.prompt).toContain('[truncated]')
  })

  it('unsupported aspect ratio falls back to 16:9', async () => {
    let capturedBody: any = null
    nock(PROXY_BASE)
      .post('/v1/images/generate', (body) => { capturedBody = body; return true })
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-fb.png' })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'test',
      aspectRatio: '4:3',  // not in supported set
    })

    expect(capturedBody.aspect_ratio).toBe('16:9')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(PROXY_BASE)
      .post('/v1/images/generate')
      .reply(400, errorFx)

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'luma-uni-1',
        prompt: 'bad request',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})

describe('LumaAdapter — video (direct Luma API)', () => {
  it('videoGeneration returns AsyncResult with provider_task_id', async () => {
    nock(VIDEO_BASE)
      .post('/dream-machine/v1/generations')
      .reply(200, videoSubmitFx)

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.videoGeneration!({
      model: 'luma-uni-1',
      prompt: 'a cinematic sunset over the ocean',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('luma')
    expect(result.provider_task_id).toBe(videoSubmitFx.id)
  })

  it('taskStatus for completed task returns succeeded with video output', async () => {
    const taskId = 'luma-task-abc123'

    nock(VIDEO_BASE)
      .get(`/dream-machine/v1/generations/${taskId}`)
      .reply(200, taskCompletedFx)

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('luma-result-abc123.mp4')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })
})
