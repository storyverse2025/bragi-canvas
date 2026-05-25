import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../helpers.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'router-test-'))
  process.env.ASSET_TMP_DIR = dir
})

describe('POST /v1/uploads', () => {
  it('accepts a PNG and returns signed URL', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: 'image/png' }), 'x.png')
    fd.append('purpose', 'reference')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.asset_id).toMatch(/^ast_/)
    expect(body.url).toContain(body.asset_id)
    expect(body.mime_type).toBe('image/png')
    expect(body.size_bytes).toBe(4)
  })

  it('rejects without auth', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([1])]), 'x.bin')
    const res = await buildApp().request('/v1/uploads', { method: 'POST', body: fd })
    expect(res.status).toBe(401)
  })
})
