import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import { storeAsset } from '../../src/assets.js'
import { materializeAsset } from '../../src/adapters/materialize-asset.js'
import { ApiError } from '../../src/errors.js'

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-mat-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = '0123456789abcdef0123456789abcdef'
  process.env.ROUTER_PUBLIC_URL = 'https://router.test'
  await storeAsset(dir, 'ast_a', Buffer.from('IMG'), 'image/png')
})

describe('materializeAsset (ast_ IDs)', () => {
  it('returns URL form', async () => {
    const r = await materializeAsset('ast_a', 'url')
    expect(r.form).toBe('url')
    expect(r.url).toContain('https://router.test/v1/assets/ast_a')
  })
  it('returns base64 form', async () => {
    const r = await materializeAsset('ast_a', 'inline-base64')
    expect(r.base64).toBe(Buffer.from('IMG').toString('base64'))
  })
  it('returns bytes form', async () => {
    const r = await materializeAsset('ast_a', 'inline-bytes')
    expect(r.bytes?.toString()).toBe('IMG')
  })
  it('throws ApiError invalid_request when asset missing', async () => {
    await expect(materializeAsset('ast_does_not_exist', 'url'))
      .rejects.toMatchObject({ code: 'invalid_request', httpStatus: 400 })
    await expect(materializeAsset('ast_does_not_exist', 'url'))
      .rejects.toBeInstanceOf(ApiError)
  })
})

describe('materializeAsset (raw https:// URL)', () => {
  it('form=url returns the URL as-is without asset store lookup', async () => {
    const r = await materializeAsset('https://example.com/image.png', 'url')
    expect(r.form).toBe('url')
    expect(r.url).toBe('https://example.com/image.png')
  })

  it('form=inline-base64 fetches the URL and returns base64', async () => {
    nock('https://example.com')
      .get('/image.png')
      .reply(200, Buffer.from('FETCHED'), { 'Content-Type': 'image/png' })

    const r = await materializeAsset('https://example.com/image.png', 'inline-base64')
    expect(r.form).toBe('inline-base64')
    expect(r.base64).toBe(Buffer.from('FETCHED').toString('base64'))
    expect(r.mimeType).toBe('image/png')

    nock.cleanAll()
  })

  it('form=url on http:// also returns as-is', async () => {
    const r = await materializeAsset('http://internal.host/img.jpg', 'url')
    expect(r.url).toBe('http://internal.host/img.jpg')
  })
})

describe('materializeAsset (data URI)', () => {
  const b64 = Buffer.from('RAWPNG').toString('base64')
  const dataUri = `data:image/png;base64,${b64}`

  it('form=inline-base64 parses the data URI and returns base64', async () => {
    const r = await materializeAsset(dataUri, 'inline-base64')
    expect(r.form).toBe('inline-base64')
    expect(r.base64).toBe(b64)
    expect(r.mimeType).toBe('image/png')
  })

  it('form=url returns the data URI itself', async () => {
    const r = await materializeAsset(dataUri, 'url')
    expect(r.url).toBe(dataUri)
    expect(r.mimeType).toBe('image/png')
  })

  it('throws on malformed data URI', async () => {
    await expect(materializeAsset('data:notvalid', 'inline-base64'))
      .rejects.toMatchObject({ code: 'invalid_request', httpStatus: 400 })
  })
})
