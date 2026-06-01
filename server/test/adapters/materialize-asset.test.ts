import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import nock from 'nock'
import { storeAsset, signAssetUrl } from '../../src/assets.js'
import { materializeAsset } from '../../src/adapters/materialize-asset.js'
import { ApiError } from '../../src/errors.js'

let assetDir: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'router-mat-'))
  assetDir = dir
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

describe('materializeAsset (router-issued signed URLs)', () => {
  function makeSignedUrl(assetId: string, host = 'https://router.test'): string {
    const secret = '0123456789abcdef0123456789abcdef'
    const expires = Math.floor(Date.now() / 1000) + 600
    const sig = signAssetUrl(assetId, expires, secret)
    return `${host}/v1/assets/${assetId}?expires=${expires}&sig=${sig}`
  }

  it('signed URL for image/png asset resolves to real mimeType (not octet-stream), form=url', async () => {
    // ast_a is stored as image/png in beforeEach
    const url = makeSignedUrl('ast_a')
    const r = await materializeAsset(url, 'url')
    expect(r.form).toBe('url')
    expect(r.mimeType).toBe('image/png')
    // Returned URL should be a fresh router asset URL (re-signed)
    expect(r.url).toMatch(/https:\/\/router\.test\/v1\/assets\/ast_a/)
  })

  it('signed URL for video/mp4 asset resolves to video/mp4 mimeType, form=url', async () => {
    // Use a hex-format ID matching newAssetId() convention
    await storeAsset(assetDir, 'ast_0000000000000001', Buffer.from('VIDEODATA'), 'video/mp4')
    const url = makeSignedUrl('ast_0000000000000001')
    const r = await materializeAsset(url, 'url')
    expect(r.form).toBe('url')
    expect(r.mimeType).toBe('video/mp4')
    expect(r.url).toMatch(/https:\/\/router\.test\/v1\/assets\/ast_0000000000000001/)
  })

  it('signed URL form=inline-base64 returns real stored bytes + real mimeType (not a network fetch)', async () => {
    // ast_a is stored as image/png with bytes 'IMG' — prove we read the store
    const url = makeSignedUrl('ast_a')
    const r = await materializeAsset(url, 'inline-base64')
    expect(r.form).toBe('inline-base64')
    expect(r.mimeType).toBe('image/png')
    expect(r.base64).toBe(Buffer.from('IMG').toString('base64'))
  })

  it('signed URL from a different host (old hostname) still resolves via path-matching', async () => {
    // Simulate a URL issued under the old nip.io hostname — the host differs from
    // ROUTER_PUBLIC_URL ('https://router.test') but the path pattern still matches.
    const url = makeSignedUrl('ast_a', 'https://old-hostname.nip.io')
    const r = await materializeAsset(url, 'url')
    expect(r.mimeType).toBe('image/png')
    expect(r.url).toMatch(/\/v1\/assets\/ast_a/)
  })

  it('genuinely external URL still returns octet-stream for form=url (regression guard)', async () => {
    const r = await materializeAsset('https://cdn.example.com/foo.png', 'url')
    expect(r.form).toBe('url')
    expect(r.url).toBe('https://cdn.example.com/foo.png')
    expect(r.mimeType).toBe('application/octet-stream')
  })

  it('signed URL pointing at non-existent ast_id throws 400 (expired asset)', async () => {
    // Use a hex-format ID that is NOT in the store
    const url = makeSignedUrl('ast_deadbeefdeadbeef')
    await expect(materializeAsset(url, 'url'))
      .rejects.toMatchObject({ code: 'invalid_request', httpStatus: 400 })
    await expect(materializeAsset(url, 'url'))
      .rejects.toBeInstanceOf(ApiError)
  })

  // --- anchored-regex guards: external URLs that merely CONTAIN the asset
  // segment must NOT be hijacked into a store lookup (the path pattern is ^…$). ---

  it('external URL with /v1/assets/ast_ as a path PREFIX is treated as external, not a store lookup', async () => {
    // ast_a IS in the store, so a false-positive match would resolve to image/png.
    // Anchoring rejects this prefix path → it stays a generic external URL.
    const r = await materializeAsset('https://evil.com/redirect/v1/assets/ast_a', 'url')
    expect(r.url).toBe('https://evil.com/redirect/v1/assets/ast_a')
    expect(r.mimeType).toBe('application/octet-stream')
  })

  it('router path with a non-ast_ id falls through to external handling', async () => {
    const r = await materializeAsset('https://router.test/v1/assets/xyz', 'url')
    expect(r.url).toBe('https://router.test/v1/assets/xyz')
    expect(r.mimeType).toBe('application/octet-stream')
  })

  it('router asset path with a trailing segment is treated as external, not a store lookup', async () => {
    const r = await materializeAsset('https://router.test/v1/assets/ast_a/raw', 'url')
    expect(r.url).toBe('https://router.test/v1/assets/ast_a/raw')
    expect(r.mimeType).toBe('application/octet-stream')
  })
})
