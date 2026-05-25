import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../helpers.js'
import { storeAsset, signAssetUrl } from '../../src/assets.js'

let dir: string
const SECRET = '0123456789abcdef0123456789abcdef'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'router-test-'))
  process.env.ASSET_TMP_DIR = dir
  process.env.ASSET_SIGNING_SECRET = SECRET
})

describe('GET /v1/assets/:id', () => {
  it('serves bytes with valid sig', async () => {
    await storeAsset(dir, 'ast_a', Buffer.from('hello'), 'text/plain')
    const expires = Math.floor(Date.now() / 1000) + 60
    const sig = signAssetUrl('ast_a', expires, SECRET)
    const res = await buildApp().request(`/v1/assets/ast_a?expires=${expires}&sig=${sig}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
  })

  it('rejects bad sig', async () => {
    await storeAsset(dir, 'ast_b', Buffer.from('x'), 'text/plain')
    const expires = Math.floor(Date.now() / 1000) + 60
    const res = await buildApp().request(`/v1/assets/ast_b?expires=${expires}&sig=BADSIG`)
    expect(res.status).toBe(403)
  })
})
