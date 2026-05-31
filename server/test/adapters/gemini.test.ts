import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import nock from 'nock'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp } from 'node:fs/promises'
import chatFx from '../fixtures/gemini/chat-success.json' with { type: 'json' }
import imgFx from '../fixtures/gemini/image-success.json' with { type: 'json' }
import videoFx from '../fixtures/gemini/video-operation.json' with { type: 'json' }
import errorFx from '../fixtures/gemini/error-400.json' with { type: 'json' }
import { GeminiAdapter } from '../../src/adapters/gemini.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://generativelanguage.googleapis.com'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'gemini-test-'))
  process.env.GEMINI_API_KEY = 'test-gemini-key'
  process.env.ROUTER_PUBLIC_URL = 'http://localhost:8787'
  process.env.ASSET_SIGNING_SECRET = 'super-secret-signing-key-16chars'
  process.env.ASSET_TMP_DIR = tmpDir
})

afterEach(() => {
  nock.cleanAll()
  delete process.env.GEMINI_API_KEY
  delete process.env.ROUTER_PUBLIC_URL
  delete process.env.ASSET_SIGNING_SECRET
  delete process.env.ASSET_TMP_DIR
})

describe('GeminiAdapter', () => {
  it('chatCompletion happy path maps Gemini response correctly', async () => {
    nock(BASE)
      .post('/v1beta/models/gemini-3-flash-preview:generateContent')
      .reply(200, chatFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.chatCompletion!({
      model: 'gemini-3-flash',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(result.status).toBe('succeeded')
    expect(result.outputs[0].kind).toBe('text')
    expect(result.outputs[0].text).toBe('Hello back from Gemini!')
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('gemini-3-flash')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('imageGeneration happy path stores base64 and returns signed asset URL', async () => {
    nock(BASE)
      .post('/v1beta/models/nano-banana-pro-preview:generateContent')
      .reply(200, imgFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.imageGeneration!({
      model: 'nano-banana-pro',
      prompt: 'a red apple',
      aspectRatio: '1:1',
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toMatch(/^http:\/\/localhost:8787\/v1\/assets\/ast_/)
    expect(result.outputs[0].url).toContain('expires=')
    expect(result.outputs[0].url).toContain('sig=')
    expect(result.outputs[0].mime_type).toBe('image/png')
  })

  it('videoGeneration returns AsyncResult with provider_task_id from operation name', async () => {
    nock(BASE)
      .post('/v1beta/models/veo-3.1-generate-preview:predictLongRunning')
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.videoGeneration!({
      model: 'veo-3.1',
      prompt: 'a sunset over the ocean',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('gemini')
    expect(result.provider_task_id).toBe(videoFx.name)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1beta/models/gemini-3-flash-preview:generateContent')
      .reply(400, errorFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    await expect(
      adapter.chatCompletion!({
        model: 'gemini-3-flash',
        messages: [{ role: 'user', content: 'bad request' }],
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })

  // ---------------------------------------------------------------------------
  // Veo videoGeneration: input_assets / durationSeconds / resolution forwarding
  // ---------------------------------------------------------------------------

  it('videoGeneration text-to-video (no input_assets) sends no image / referenceImages', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1beta/models/veo-3.1-generate-preview:predictLongRunning', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.videoGeneration!({
      model: 'veo-3.1',
      prompt: 'a sunset over the ocean',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.instances[0].prompt).toBe('a sunset over the ocean')
    expect(capturedBody.instances[0].image).toBeUndefined()
    expect(capturedBody.instances[0].referenceImages).toBeUndefined()
    expect(capturedBody.parameters.aspectRatio).toBe('16:9')
    expect(capturedBody.parameters.durationSeconds).toBeUndefined()
    expect(capturedBody.parameters.resolution).toBeUndefined()
  })

  it('videoGeneration with one input_asset sends image as bytesBase64Encoded (first-frame)', async () => {
    await storeAsset(tmpDir, 'ast_img1', Buffer.from('IMGDATA1'), 'image/png')

    let capturedBody: any
    nock(BASE)
      .post('/v1beta/models/veo-3.1-generate-preview:predictLongRunning', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.videoGeneration!({
      model: 'veo-3.1',
      prompt: 'animate from this',
      aspectRatio: '16:9',
      input_assets: ['ast_img1'],
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.instances[0].image).toBeDefined()
    expect(capturedBody.instances[0].image.bytesBase64Encoded).toBe(
      Buffer.from('IMGDATA1').toString('base64'),
    )
    expect(capturedBody.instances[0].image.mimeType).toBe('image/png')
    expect(capturedBody.instances[0].referenceImages).toBeUndefined()
  })

  it('videoGeneration with multiple input_assets sends referenceImages for extras', async () => {
    await storeAsset(tmpDir, 'ast_img1', Buffer.from('IMG1'), 'image/png')
    await storeAsset(tmpDir, 'ast_img2', Buffer.from('IMG2'), 'image/jpeg')
    await storeAsset(tmpDir, 'ast_img3', Buffer.from('IMG3'), 'image/png')

    let capturedBody: any
    nock(BASE)
      .post('/v1beta/models/veo-3.1-generate-preview:predictLongRunning', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.videoGeneration!({
      model: 'veo-3.1',
      prompt: 'with style refs',
      aspectRatio: '16:9',
      input_assets: ['ast_img1', 'ast_img2', 'ast_img3'],
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.instances[0].image.bytesBase64Encoded).toBe(
      Buffer.from('IMG1').toString('base64'),
    )
    expect(capturedBody.instances[0].image.mimeType).toBe('image/png')
    expect(Array.isArray(capturedBody.instances[0].referenceImages)).toBe(true)
    expect(capturedBody.instances[0].referenceImages).toHaveLength(2)
    expect(capturedBody.instances[0].referenceImages[0].image.bytesBase64Encoded).toBe(
      Buffer.from('IMG2').toString('base64'),
    )
    expect(capturedBody.instances[0].referenceImages[0].image.mimeType).toBe('image/jpeg')
    expect(capturedBody.instances[0].referenceImages[1].image.bytesBase64Encoded).toBe(
      Buffer.from('IMG3').toString('base64'),
    )
  })

  it('videoGeneration forwards durationSeconds and resolution into parameters', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1beta/models/veo-3.1-generate-preview:predictLongRunning', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    await adapter.videoGeneration!({
      model: 'veo-3.1',
      prompt: 'a sunset',
      aspectRatio: '16:9',
      durationSeconds: 8,
      resolution: '1080p',
    })

    expect(capturedBody.parameters.aspectRatio).toBe('16:9')
    expect(capturedBody.parameters.durationSeconds).toBe(8)
    expect(capturedBody.parameters.resolution).toBe('1080p')
  })

  it('videoGeneration veo-3.1-lite with single input_asset routes to lite upstream model', async () => {
    await storeAsset(tmpDir, 'ast_img1', Buffer.from('IMGDATA1'), 'image/png')

    let capturedBody: any
    nock(BASE)
      .post('/v1beta/models/veo-3.1-lite-generate-preview:predictLongRunning', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoFx)

    const adapter = new GeminiAdapter('test-gemini-key')
    const result = await adapter.videoGeneration!({
      model: 'veo-3.1-lite',
      prompt: 'animate from this',
      aspectRatio: '9:16',
      input_assets: ['ast_img1'],
      durationSeconds: 4,
      resolution: '720p',
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.instances[0].image.bytesBase64Encoded).toBe(
      Buffer.from('IMGDATA1').toString('base64'),
    )
    expect(capturedBody.parameters.durationSeconds).toBe(4)
    expect(capturedBody.parameters.resolution).toBe('720p')
  })
})
