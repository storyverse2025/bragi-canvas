import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import chatFx from '../fixtures/tokenrouter/chat-success.json' with { type: 'json' }
import errorFx from '../fixtures/tokenrouter/error-400.json' with { type: 'json' }
import videoCreatedFx from '../fixtures/tokenrouter/video-task-created.json' with { type: 'json' }
import videoRunningFx from '../fixtures/tokenrouter/video-task-running.json' with { type: 'json' }
import videoCompletedFx from '../fixtures/tokenrouter/video-task-completed.json' with { type: 'json' }
import videoFailedFx from '../fixtures/tokenrouter/video-task-failed.json' with { type: 'json' }
import { TokenrouterAdapter } from '../../src/adapters/tokenrouter.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://api.tokenrouter.com'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-tokenrouter-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_img1', Buffer.from('IMGDATA1'), 'image/png')
  await storeAsset(dir, 'ast_vid1', Buffer.from('VIDDATA'), 'video/mp4')
})

afterEach(() => {
  nock.cleanAll()
})

describe('TokenrouterAdapter', () => {
  it('chatCompletion qwen-3-6-plus happy path returns text output', async () => {
    nock(BASE)
      .post('/v1/chat/completions')
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'qwen-3-6-plus',
      messages: [
        { role: 'user', content: 'Hello, who are you?' },
      ],
    })

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('text')
    expect(result.outputs[0].text).toContain('Qwen')
    expect(result.provider).toBe('tokenrouter')
    expect(result.model).toBe('qwen-3-6-plus')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('chatCompletion gpt-5.5-pro maps to openai/gpt-5.5', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'gpt-5.5-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe('openai/gpt-5.5')
    expect(result.model).toBe('gpt-5.5-pro')
  })

  it('chatCompletion gemini-3.1-pro maps to google/gemini-3.1-pro-preview', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'gemini-3.1-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe('google/gemini-3.1-pro-preview')
    expect(result.model).toBe('gemini-3.1-pro')
  })

  it('chatCompletion gemini-3-flash maps to google/gemini-3-flash-preview', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe('google/gemini-3-flash-preview')
  })

  it('chatCompletion claude-opus-4-7 maps to anthropic/claude-opus-4.7', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'claude-opus-4-7',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe('anthropic/claude-opus-4.7')
    expect(result.model).toBe('claude-opus-4-7')
    expect(result.outputs[0].text).toBeDefined()
  })

  it('chatCompletion grok-4-3 maps to x-ai/grok-4.3', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: 'grok-4-3',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe('x-ai/grok-4.3')
    expect(result.model).toBe('grok-4-3')
    expect(result.outputs[0].text).toBeDefined()
  })

  // Lock the remaining 4 new-model id mappings (id typos are the key risk).
  it.each([
    ['gpt-5.5', 'openai/gpt-5.5'],
    ['gemini-3.5-flash', 'google/gemini-3.5-flash'],
    ['claude-sonnet-4-6', 'anthropic/claude-sonnet-4.6'],
    ['grok-4-fast', 'x-ai/grok-4.1-fast'],
  ])('chatCompletion %s maps to %s', async (model, upstream) => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
      .reply(200, chatFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.chatCompletion!({
      model: model as any,
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(capturedBody.model).toBe(upstream)
    expect(result.model).toBe(model)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/chat/completions')
      .reply(401, errorFx)

    const adapter = new TokenrouterAdapter('sk-bad-key')
    await expect(
      adapter.chatCompletion!({
        model: 'qwen-3-6-plus',
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })

  it('network failure maps to provider_unavailable 503', async () => {
    nock(BASE)
      .post('/v1/chat/completions')
      .replyWithError('ECONNREFUSED')

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await expect(
      adapter.chatCompletion!({
        model: 'qwen-3-6-plus',
        messages: [{ role: 'user', content: 'hi' }],
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })
})

describe('TokenrouterAdapter videoGeneration', () => {
  it('seedance-2.0 posts to /v1/videos and returns queued AsyncResult', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'a cat walking',
      ratio: '16:9',
      duration: '5',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('tokenrouter')
    expect(result.provider_task_id).toBe('tr-video-task-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
    expect(capturedBody.model).toBe('dreamina-seedance-2-0-260128')
    expect(capturedBody.prompt).toBe('a cat walking')
    // tokenrouter Videos API expects seconds as a string
    expect(capturedBody.seconds).toBe('5')
  })

  it('seedance-2.0-fast maps to dreamina-seedance-2-0-fast-260128', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0-fast',
      prompt: 'quick clip',
      ratio: '9:16',
      duration: '5',
    })

    expect(capturedBody.model).toBe('dreamina-seedance-2-0-fast-260128')
  })

  it('9:16 ratio maps to portrait size', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'portrait',
      ratio: '9:16',
      duration: '5',
    })

    const [w, h] = (capturedBody.size as string).split('x').map(Number)
    expect(h).toBeGreaterThan(w)
  })

  it('with input_assets sends image_url as signed URL', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'image to video',
      ratio: '16:9',
      duration: '5',
      input_assets: ['ast_img1'],
    })

    expect(capturedBody.image_url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1\?expires=/)
  })

  it('v2v: video asset sets video_url (not image_url) in request body', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'video to video',
      ratio: '16:9',
      duration: '5',
      input_assets: ['ast_vid1'],
    })

    expect(capturedBody.video_url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_vid1\?expires=/)
    expect(capturedBody.image_url).toBeUndefined()
  })

  it('1080p resolution for 16:9 ratio maps to size 1920x1080', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: '1080p clip',
      ratio: '16:9',
      duration: '5',
      resolution: '1080p',
    })

    expect(capturedBody.size).toBe('1920x1080')
  })

  it('480p resolution for 16:9 ratio maps to size 854x480', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos', (body) => { capturedBody = body; return true })
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: '480p clip',
      ratio: '16:9',
      duration: '5',
      resolution: '480p',
    })

    expect(capturedBody.size).toBe('854x480')
  })
})

describe('TokenrouterAdapter taskStatus', () => {
  it('pending status returns running', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .reply(200, videoCreatedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.taskStatus!('tr-video-task-abc123')
    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('running status returns running', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .reply(200, videoRunningFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.taskStatus!('tr-video-task-abc123')
    expect(result.status).toBe('running')
  })

  it('in_progress status returns running (observed live status value)', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .reply(200, {
        task_id: 'tr-video-task-abc123',
        status: 'in_progress',
        progress: 50,
        model: 'dreamina-seedance-2-0-260128',
        metadata: { url: '' },
      })

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.taskStatus!('tr-video-task-abc123')
    expect(result.status).toBe('running')
  })

  it('completed status returns succeeded with video URL', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .reply(200, videoCompletedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.taskStatus!('tr-video-task-abc123')
    expect(result.status).toBe('succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toBe('https://cdn.tokenrouter.com/videos/seedance-result-abc123.mp4')
  })

  it('failed status returns failed with error message', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .reply(200, videoFailedFx)

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    const result = await adapter.taskStatus!('tr-video-task-abc123')
    expect(result.status).toBe('failed')
    expect(result.error?.message).toBe('Content policy violation')
  })

  it('network error maps to provider_unavailable', async () => {
    nock(BASE)
      .get('/v1/videos/tr-video-task-abc123')
      .replyWithError('ECONNREFUSED')

    const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
    await expect(
      adapter.taskStatus!('tr-video-task-abc123')
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })
})
