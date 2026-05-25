import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { mkdir, writeFile, stat, readFile, unlink, readdir } from 'node:fs/promises'
import { join, extname } from 'node:path'

export function newAssetId(): string {
  return 'ast_' + randomBytes(8).toString('hex')
}

export function signAssetUrl(assetId: string, expiresSec: number, secret: string): string {
  const h = createHmac('sha256', secret)
  h.update(`${assetId}:${expiresSec}`)
  return h.digest('hex')
}

export function verifyAssetSig(assetId: string, expiresSec: number, sig: string, secret: string): boolean {
  if (expiresSec < Math.floor(Date.now() / 1000)) return false
  const expected = signAssetUrl(assetId, expiresSec, secret)
  const a = Buffer.from(sig, 'hex')
  const b = Buffer.from(expected, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export interface StoredAsset {
  path: string
  mimeType: string
  sizeBytes: number
}

export async function storeAsset(
  tmpDir: string,
  assetId: string,
  bytes: Buffer,
  mimeType: string,
): Promise<StoredAsset> {
  await mkdir(tmpDir, { recursive: true })
  const ext = mimeToExt(mimeType)
  const path = join(tmpDir, `${assetId}${ext}`)
  await writeFile(path, bytes)
  return { path, mimeType, sizeBytes: bytes.length }
}

export async function readAsset(tmpDir: string, assetId: string): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const files = await readdir(tmpDir).catch(() => [])
  const match = files.find(f => f.startsWith(assetId))
  if (!match) return null
  const bytes = await readFile(join(tmpDir, match))
  const ext = extname(match)
  return { bytes, mimeType: extToMime(ext) }
}

export async function cleanupExpiredAssets(tmpDir: string, ttlSec: number): Promise<number> {
  const now = Date.now()
  let removed = 0
  const files = await readdir(tmpDir).catch(() => [])
  for (const f of files) {
    const s = await stat(join(tmpDir, f)).catch(() => null)
    if (s && now - s.mtimeMs > ttlSec * 1000) {
      await unlink(join(tmpDir, f)).catch(() => {})
      removed++
    }
  }
  return removed
}

function mimeToExt(m: string): string {
  if (m === 'image/png') return '.png'
  if (m === 'image/jpeg') return '.jpg'
  if (m === 'image/webp') return '.webp'
  if (m === 'video/mp4') return '.mp4'
  if (m === 'audio/mpeg') return '.mp3'
  if (m === 'audio/wav') return '.wav'
  if (m === 'application/pdf') return '.pdf'
  return ''
}

function extToMime(e: string): string {
  if (e === '.png') return 'image/png'
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg'
  if (e === '.webp') return 'image/webp'
  if (e === '.mp4') return 'video/mp4'
  if (e === '.mp3') return 'audio/mpeg'
  if (e === '.wav') return 'audio/wav'
  if (e === '.pdf') return 'application/pdf'
  return 'application/octet-stream'
}
