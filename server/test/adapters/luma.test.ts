import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import errorFx from '../fixtures/luma/error-400.json' with { type: 'json' }
import { LumaAdapter } from '../../src/adapters/luma.js'
import { storeAsset } from '../../src/assets.js'

const PROXY_BASE = 'https://luma.bragi.now'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-luma-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_img1', Buffer.from('IMGDATA1'), 'image/png')
})

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

describe('LumaAdapter — image I2I (img2img proxy)', () => {
  it('imageGeneration with input_asset hits /v1/images/img2img and sends image_url', async () => {
    let capturedBody: any = null
    let capturedPath = ''
    nock(PROXY_BASE)
      .post('/v1/images/img2img', (body) => { capturedBody = body; return true })
      .reply(function () {
        capturedPath = this.req.path
        return [200, { image_url: 'https://luma.bragi.now/output/img-i2i.png' }]
      })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'edit this image',
      aspectRatio: '16:9',
      input_assets: ['ast_img1'],
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(capturedPath).toBe('/v1/images/img2img')
    expect(capturedBody.image_url).toMatch(/^https:\/\/router\.test\/v1\/assets\/ast_img1/)
    expect(capturedBody.aspect_ratio).toBe('16:9')
    expect(result.outputs[0].url).toContain('img-i2i.png')
  })

  it('luma-uni-1 has no videoGeneration method (moved to image capability)', () => {
    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    // luma-uni-1 is now image-only; videoGeneration must not exist on the adapter
    expect(adapter.videoGeneration).toBeUndefined()
    expect(adapter.taskStatus).toBeUndefined()
  })
})
