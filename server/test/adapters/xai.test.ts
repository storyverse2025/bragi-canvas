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

  // ---------------------------------------------------------------------------
  // grok-tts — `language` is accepted in schema for plugin parity but is an
  // HONEST no-op on the OpenAI-compatible /v1/audio/speech endpoint (which has
  // no language field). Real support needs the native /v1/tts switch (follow-up).
  // ---------------------------------------------------------------------------

  it('grok-tts does NOT forward language to /v1/audio/speech (honest no-op; endpoint ignores it)', async () => {
    const fakeAudio = Buffer.from('fake-mp3-audio-bytes')
    let capturedBody: any
    nock(BASE)
      .post('/v1/audio/speech', body => {
        capturedBody = body
        return true
      })
      .reply(200, fakeAudio, { 'Content-Type': 'audio/mpeg' })

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.audioSpeech!({
      model: 'grok-tts',
      input: 'Hello',
      voice: 'nova',
      response_format: 'mp3',
      language: 'zh',
    })

    // language is intentionally absent from the body — see adapter comment.
    expect(capturedBody.language).toBeUndefined()
    expect(capturedBody.input).toBe('Hello')
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
      duration: '5',
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

  it("taskStatus maps xAI status 'done' (real success value) to succeeded with nested video.url", async () => {
    // Real xAI returns {status:'done', video:{url}} — NOT 'succeeded'/'completed'.
    // Fixture mirrors that so this test guards the done→succeeded mapping.
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

  it("taskStatus maps xAI status 'expired' to failed (was silently stuck on running)", async () => {
    const taskId = 'e1719105-a601-9742-84c7-testexpired1'
    nock(BASE)
      .get(`/v1/videos/${taskId}`)
      .reply(200, { status: 'expired', error: { message: 'task expired' } })

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('failed')
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
        duration: '5',
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  // ---------------------------------------------------------------------------
  // grok-video: t2v / first-frame / video-extend branching + param forwarding
  // ---------------------------------------------------------------------------

  it('videoGeneration grok-video text-to-video sends no image/video field', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a sunset over the ocean',
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.model).toBe('grok-imagine-video')
    expect(capturedBody.prompt).toBe('a sunset over the ocean')
    expect(capturedBody.image).toBeUndefined()
    expect(capturedBody.video).toBeUndefined()
    expect(capturedBody.image_url).toBeUndefined()
    expect(capturedBody.video_url).toBeUndefined()
  })

  it('videoGeneration grok-video first-frame i2v sends image: { url } (image asset)', async () => {
    // ast_img1 is stored as image/png in beforeEach
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'animate from this frame',
      input_assets: ['ast_img1'],
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.image).toBeDefined()
    expect(capturedBody.image.url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1/)
    expect(capturedBody.video).toBeUndefined()
  })

  it('videoGeneration grok-video video-extend sends video: { url } and hits /videos/extensions (video asset)', async () => {
    // Store a video-mime asset to trigger the video-extend branch
    const dir = process.env.ASSET_TMP_DIR!
    await storeAsset(dir, 'ast_vid1', Buffer.from('VIDEODATA'), 'video/mp4')

    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/extensions', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'continue this video',
      input_assets: ['ast_vid1'],
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.video).toBeDefined()
    expect(capturedBody.video.url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_vid1/)
    expect(capturedBody.image).toBeUndefined()
  })

  it('videoGeneration grok-video: raw http(s) URL asset routes to first-frame i2v (octet-stream falls through to image)', async () => {
    // Documents current behaviour (xai.ts:168-177): materializeAsset(url,'url')
    // returns application/octet-stream WITHOUT fetching (materialize-asset.ts:30),
    // so a raw/signed *video* URL cannot reach the video-extend branch and is
    // sent as a first-frame image instead. Resolving real MIME for URL-form
    // assets is Task 1.4's scope (router-issued signed URLs); this test pins the
    // present behaviour so the change there is deliberate, not silent.
    let capturedBody: any
    let capturedPath = ''
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(function () {
        capturedPath = this.req.path
        return [200, videoSubmitFx]
      })

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'extend this clip',
      input_assets: ['https://cdn.example.com/clip.mp4'],
    })

    expect(result.status).toBe('queued')
    expect(capturedPath).toContain('/v1/videos/generations') // NOT /videos/extensions
    expect(capturedBody.image).toBeDefined()
    expect(capturedBody.image.url).toBe('https://cdn.example.com/clip.mp4')
    expect(capturedBody.video).toBeUndefined()
  })

  // ---------------------------------------------------------------------------
  // grok-video: image-ref mode (explicit + inferred) + duration clamp
  // ---------------------------------------------------------------------------

  it('videoGeneration grok-video explicit mode:image-ref with 2 assets → reference_images, no body.image, /videos/generations', async () => {
    const dir = process.env.ASSET_TMP_DIR!
    await storeAsset(dir, 'ast_img2', Buffer.from('IMGDATA2'), 'image/jpeg')

    let capturedBody: any
    let capturedPath = ''
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(function () {
        capturedPath = this.req.path
        return [200, videoSubmitFx]
      })

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'two reference images',
      input_assets: ['ast_img1', 'ast_img2'],
      mode: 'image-ref',
    } as any)

    expect(result.status).toBe('queued')
    expect(capturedPath).toContain('/v1/videos/generations')
    expect(capturedBody.reference_images).toBeDefined()
    expect(capturedBody.reference_images).toHaveLength(2)
    expect(capturedBody.reference_images[0].url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1/)
    expect(capturedBody.reference_images[1].url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img2/)
    expect(capturedBody.image).toBeUndefined()
    expect(capturedBody.video).toBeUndefined()
  })

  it('videoGeneration grok-video ≥2 assets no mode → inferred image-ref (reference_images)', async () => {
    const dir = process.env.ASSET_TMP_DIR!
    await storeAsset(dir, 'ast_img2', Buffer.from('IMGDATA2'), 'image/jpeg')
    await storeAsset(dir, 'ast_img3', Buffer.from('IMGDATA3'), 'image/png')

    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'three refs no explicit mode',
      input_assets: ['ast_img1', 'ast_img2', 'ast_img3'],
    } as any)

    expect(result.status).toBe('queued')
    expect(capturedBody.reference_images).toBeDefined()
    expect(capturedBody.reference_images).toHaveLength(3)
    expect(capturedBody.image).toBeUndefined()
  })

  it('videoGeneration grok-video image-ref with duration 15 → body.duration clamped to 10', async () => {
    const dir = process.env.ASSET_TMP_DIR!
    await storeAsset(dir, 'ast_img2', Buffer.from('IMGDATA2'), 'image/jpeg')

    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'long image ref',
      input_assets: ['ast_img1', 'ast_img2'],
      mode: 'image-ref',
      duration: '15',
    } as any)

    // xAI caps image-ref at 10s (plugin xai.ts:160); clamp applied in adapter
    expect(capturedBody.duration).toBe(10)
  })

  it('videoGeneration grok-video explicit mode requiring an asset throws 400 when none given', async () => {
    const adapter = new XAIAdapter('xai-test-key')
    // video-extend / first-frame both require ≥1 asset; with none → ApiError 400.
    for (const mode of ['video-extend', 'first-frame'] as const) {
      await expect(
        adapter.videoGeneration!({ model: 'grok-video', prompt: 'x', mode } as any)
      ).rejects.toMatchObject({ code: 'invalid_request', httpStatus: 400 })
    }
  })

  // ---------------------------------------------------------------------------
  // grok-imagine: quality tier + image-ref (plugin parity)
  // ---------------------------------------------------------------------------

  it('grok-imagine quality=normal uses grok-imagine-image (not quality tier)', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'test',
      aspectRatio: '1:1',
      quality: 'normal',
    } as any)

    expect(capturedBody.model).toBe('grok-imagine-image')
  })

  it('grok-imagine quality=quality (default) uses grok-imagine-image-quality', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'test',
      aspectRatio: '16:9',
      quality: 'quality',
    } as any)

    expect(capturedBody.model).toBe('grok-imagine-image-quality')
  })

  it('grok-imagine with 1 input_asset hits /images/edits with body.image={url}', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/images/edits', (body) => { capturedBody = body; return true })
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    const result = await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'edit this',
      aspectRatio: '1:1',
      input_assets: ['ast_img1'],
    } as any)

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(capturedBody.image).toBeDefined()
    expect(capturedBody.image.url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1/)
    expect(capturedBody.images).toBeUndefined()
  })

  it('grok-imagine with 2+ input_assets hits /images/edits with body.images=[{url}…]', async () => {
    const dir = process.env.ASSET_TMP_DIR!
    await storeAsset(dir, 'ast_img2', Buffer.from('IMGDATA2'), 'image/png')

    let capturedBody: any
    nock(BASE)
      .post('/v1/images/edits', (body) => { capturedBody = body; return true })
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'blend these',
      aspectRatio: '1:1',
      input_assets: ['ast_img1', 'ast_img2'],
    } as any)

    expect(capturedBody.images).toBeDefined()
    expect(capturedBody.images).toHaveLength(2)
    expect(capturedBody.images[0].url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1/)
    expect(capturedBody.images[1].url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img2/)
    expect(capturedBody.image).toBeUndefined()
  })

  it('grok-imagine with 5 input_assets sends up to 5 in body.images', async () => {
    const dir = process.env.ASSET_TMP_DIR!
    for (const i of ['2', '3', '4', '5']) {
      await storeAsset(dir, `ast_img${i}`, Buffer.from(`IMGDATA${i}`), 'image/png')
    }

    let capturedBody: any
    nock(BASE)
      .post('/v1/images/edits', (body) => { capturedBody = body; return true })
      .reply(200, imageFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'many refs',
      aspectRatio: '1:1',
      input_assets: ['ast_img1', 'ast_img2', 'ast_img3', 'ast_img4', 'ast_img5'],
    } as any)

    expect(capturedBody.images).toHaveLength(5)
    expect(capturedBody.image).toBeUndefined()
  })

  it('grok-imagine text-to-image hits /images/generations (no input_assets)', async () => {
    let capturedPath = ''
    nock(BASE)
      .post('/v1/images/generations', () => true)
      .reply(function () {
        capturedPath = this.req.path
        return [200, imageFx]
      })

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.imageGeneration!({
      model: 'grok-imagine',
      prompt: 'landscape',
      aspectRatio: '16:9',
    } as any)

    expect(capturedPath).toContain('/v1/images/generations')
  })

  it('videoGeneration grok-video forwards duration / aspect_ratio / resolution as snake_case', async () => {
    let capturedBody: any
    nock(BASE)
      .post('/v1/videos/generations', (body) => {
        capturedBody = body
        return true
      })
      .reply(200, videoSubmitFx)

    const adapter = new XAIAdapter('xai-test-key')
    await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a sunset',
      duration: '10',
      aspect_ratio: '9:16',
      resolution: '1080p',
    })

    // xAI takes duration as a number (plugin parseInt's it before sending);
    // aspect_ratio + resolution are snake_case strings.
    expect(capturedBody.duration).toBe(10)
    expect(capturedBody.aspect_ratio).toBe('9:16')
    expect(capturedBody.resolution).toBe('1080p')
  })
})
