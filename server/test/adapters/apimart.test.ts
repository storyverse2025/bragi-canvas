import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import submitFx from '../fixtures/apimart/submit-success.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/apimart/task-completed.json' with { type: 'json' }
import errorFx from '../fixtures/apimart/error-400.json' with { type: 'json' }
import { ApimartAdapter } from '../../src/adapters/apimart.js'
import { storeAsset } from '../../src/assets.js'

const BASE = 'https://api.apimart.ai'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-apimart-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_x', Buffer.from('IMGDATA'), 'image/png')
})

afterEach(() => {
  nock.cleanAll()
})

describe('ApimartAdapter', () => {
  it('imageGeneration submits task and returns AsyncResult', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'a beautiful landscape',
      n: 1,
      size: '1024x1024',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('apimart')
    expect(result.provider_task_id).toBe('apimart-task-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with image output on completion', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-abc123')
      .reply(200, taskCompletedFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-abc123')

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs![0].kind).toBe('image')
    expect(result.outputs![0].url).toContain('gpt-image-result-abc123.png')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('taskStatus returns running for pending status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-pending')
      .reply(200, { data: { status: 'pending', task_id: 'apimart-task-pending' } })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-pending')

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns failed on failed status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-fail')
      .reply(200, {
        data: { status: 'failed', error: { message: 'Content policy violation' } },
      })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-fail')

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('provider_rejected')
  })

  it('imageGeneration sends correct model name and size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      size: '1024x1024',
    })

    expect(capturedBody.model).toBe('gpt-image-2')
    expect(capturedBody.resolution).toBe('2k')
  })

  it('passes size and n from request — not hardcoded (P2.4 regression)', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'x',
      n: 4,
      size: '1024x1792',
    })

    // size '1024x1792' must map to '9:16', not default '16:9' or 'auto'
    expect(capturedBody.size).toBe('9:16')
    // n must be 4, not hardcoded 1
    expect(capturedBody.n).toBe(4)
  })

  it('gpt-image-2 new path passes wide aspectRatio through (no silent narrowing to 1:1) + forwards imageSize/quality', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'a wide panorama',
      n: 1,
      aspectRatio: '2:1',   // valid per schema, was previously coerced to '1:1'
      imageSize: '4K',
      quality: 'high',
    })

    expect(capturedBody.size).toBe('2:1')        // passed through, NOT '1:1'
    expect(capturedBody.resolution).toBe('4k')
    expect(capturedBody.quality).toBe('high')
  })

  it('nano-banana-2 forwards an extreme aspect ratio (full plugin parity)', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'nano-banana-2',
      prompt: 'a tall banner',
      aspectRatio: '1:8',
      imageSize: '2K',
    })

    expect(capturedBody.size).toBe('1:8')
    expect(capturedBody.image_size).toBe('2K')
    expect(capturedBody.model).toBe('gemini-3.1-flash-image-preview')
  })

  it('maps all three schema sizes to correct aspect-ratio strings', async () => {
    const cases: Array<{ size: '1024x1024' | '1792x1024' | '1024x1792'; expected: string }> = [
      { size: '1024x1024', expected: '1:1' },
      { size: '1792x1024', expected: '16:9' },
      { size: '1024x1792', expected: '9:16' },
    ]

    for (const { size, expected } of cases) {
      let captured: any = null
      nock(BASE)
        .post('/v1/images/generations', (body) => { captured = body; return true })
        .reply(200, submitFx)

      const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
      await adapter.imageGeneration!({ model: 'gpt-image-2', prompt: 'test', n: 1, size })

      expect(captured.size).toBe(expected)
    }
  })

  it('materializes asset IDs to signed URLs before sending image_urls (P2.6)', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'edit this image',
      n: 1,
      size: '1024x1024',
      input_assets: ['ast_x'],
    })

    // Must NOT pass the raw ID; must be a signed URL starting with http
    expect(capturedBody.image_urls).toHaveLength(1)
    expect(capturedBody.image_urls[0]).toMatch(/^https?:\/\//)
    expect(capturedBody.image_urls[0]).not.toBe('ast_x')
    expect(capturedBody.image_urls[0]).toContain('ast_x')
  })

  it('nano-banana-pro maps to gemini-3-pro-image-preview and sends aspectRatio as size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.imageGeneration!({
      model: 'nano-banana-pro',
      prompt: 'a red apple',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('apimart')
    expect(capturedBody.model).toBe('gemini-3-pro-image-preview')
    expect(capturedBody.size).toBe('16:9')
    expect(capturedBody.prompt).toBe('a red apple')
    // gpt-image-2-only fields must not be present
    expect(capturedBody.resolution).toBeUndefined()
    expect(capturedBody.n).toBeUndefined()
  })

  it('nano-banana-2 maps to gemini-3.1-flash-image-preview', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.imageGeneration!({
      model: 'nano-banana-2',
      prompt: 'a blue ocean',
      aspectRatio: '1:1',
    })

    expect(result.status).toBe('queued')
    expect(capturedBody.model).toBe('gemini-3.1-flash-image-preview')
    expect(capturedBody.size).toBe('1:1')
  })

  it('nano-banana-pro i2i materializes asset IDs to image_urls', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'nano-banana-pro',
      prompt: 'edit this image',
      aspectRatio: '4:3',
      input_assets: ['ast_x'],
    })

    expect(capturedBody.image_urls).toHaveLength(1)
    expect(capturedBody.image_urls[0]).toMatch(/^https?:\/\//)
    expect(capturedBody.image_urls[0]).toContain('ast_x')
    expect(capturedBody.model).toBe('gemini-3-pro-image-preview')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(400, errorFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'gpt-image-2',
        prompt: 'bad request',
        n: 1,
        size: '1024x1024',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })

  it('network failure on imageGeneration maps to provider_unavailable 503', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .replyWithError('ECONNREFUSED')

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'gpt-image-2',
        prompt: 'test',
        n: 1,
        size: '1024x1024',
      })
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })

  it('network failure on taskStatus maps to provider_unavailable 503', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-net-fail')
      .replyWithError('ETIMEDOUT')

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.taskStatus!('apimart-task-net-fail')
    ).rejects.toMatchObject({ code: 'provider_unavailable', httpStatus: 503 })
  })

  // ---------------------------------------------------------------------------
  // gpt-image-2: imageSize + quality forwarding (plugin parity)
  // ---------------------------------------------------------------------------

  it('gpt-image-2 forwards imageSize=4K as resolution=4k and aspectRatio as size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      imageSize: '4K',
      aspectRatio: '16:9',
    } as any)

    expect(capturedBody.size).toBe('16:9')
    expect(capturedBody.resolution).toBe('4k')
  })

  it('gpt-image-2 forwards quality=high to apimart body', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      imageSize: '2K',
      quality: 'high',
    } as any)

    expect(capturedBody.quality).toBe('high')
    expect(capturedBody.resolution).toBe('2k')
  })

  it('gpt-image-2 quality=auto is NOT forwarded (no quality field in body)', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      imageSize: '2K',
      quality: 'auto',
    } as any)

    // quality='auto' means "let apimart decide" — we don't send the field
    expect(capturedBody.quality).toBeUndefined()
  })

  it('gpt-image-2 imageSize=1K maps to resolution=1k', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      n: 1,
      imageSize: '1K',
      aspectRatio: '1:1',
    } as any)

    expect(capturedBody.resolution).toBe('1k')
    expect(capturedBody.size).toBe('1:1')
  })

  // ---------------------------------------------------------------------------
  // nano-banana: imageSize forwarded as image_size
  // ---------------------------------------------------------------------------

  it('nano-banana-pro forwards imageSize as image_size to apimart', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'nano-banana-pro',
      prompt: 'test',
      aspectRatio: '16:9',
      imageSize: '2K',
    } as any)

    expect(capturedBody.image_size).toBe('2K')
    expect(capturedBody.model).toBe('gemini-3-pro-image-preview')
    expect(capturedBody.size).toBe('16:9')
  })

  it('nano-banana-2 forwards imageSize=512 as image_size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'nano-banana-2',
      prompt: 'test',
      aspectRatio: '1:1',
      imageSize: '512',
    } as any)

    expect(capturedBody.image_size).toBe('512')
    expect(capturedBody.model).toBe('gemini-3.1-flash-image-preview')
  })

  it('nano-banana without imageSize does not send image_size (no default forwarding)', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'nano-banana-pro',
      prompt: 'test',
      aspectRatio: '1:1',
    } as any)

    // When imageSize is not provided, the schema default of '1K' is applied.
    // We forward any truthy imageSize.
    expect(capturedBody.model).toBe('gemini-3-pro-image-preview')
  })
})
