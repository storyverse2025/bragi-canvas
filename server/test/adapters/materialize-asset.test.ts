import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

describe('materializeAsset', () => {
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
