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

  it('rejects file exceeding 50MB with 400', async () => {
    // Create a blob > 50MB
    const FIFTY_MB_PLUS_ONE = 50 * 1024 * 1024 + 1
    const bigBlob = new Blob([new Uint8Array(FIFTY_MB_PLUS_ONE)], { type: 'image/png' })
    const fd = new FormData()
    fd.append('file', bigBlob, 'big.png')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toMatch(/too large/)
  })

  it('rejects disallowed MIME type (application/octet-stream) with 400', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' }), 'x.bin')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
    expect(body.error.message).toMatch(/unsupported file type/)
  })

  it('rejects text/plain MIME type with 400', async () => {
    const fd = new FormData()
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'readme.txt')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('invalid_request')
  })

  it('accepts video/mp4 MIME type', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([0, 0, 0, 20])], { type: 'video/mp4' }), 'clip.mp4')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mime_type).toBe('video/mp4')
  })

  it('accepts application/pdf MIME type', async () => {
    const fd = new FormData()
    fd.append('file', new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: 'application/pdf' }), 'doc.pdf')
    const res = await buildApp().request('/v1/uploads', {
      method: 'POST',
      headers: { Authorization: 'Bearer svsk-test-1' },
      body: fd,
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mime_type).toBe('application/pdf')
  })
})
