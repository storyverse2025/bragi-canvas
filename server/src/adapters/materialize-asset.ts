import { readAsset, signAssetUrl } from '../assets.js'
import { env } from '../env.js'
import { ApiError } from '../errors.js'

export type AssetForm = 'url' | 'inline-base64' | 'inline-bytes'

export interface MaterializedAsset {
  form: AssetForm
  url?: string
  base64?: string
  bytes?: Buffer
  mimeType: string
}

/**
 * Materialize an asset reference into the requested form.
 *
 * Accepts three input shapes:
 *   - http(s):// URL  → already a public URL; use directly (or fetch for inline forms)
 *   - data:<mime>;base64,<...>  → inline data URI; parse and use directly
 *   - ast_… ID        → look up in local asset store (existing behavior)
 *
 * This means callers can pass a raw public URL in input_assets and it will
 * be forwarded as-is (form=url) or fetched (form=inline-*).
 */
export async function materializeAsset(ref: string, form: AssetForm): Promise<MaterializedAsset> {
  // --- raw https/http URL: caller already has a public URL ---
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    if (form === 'url') {
      return { form: 'url', url: ref, mimeType: 'application/octet-stream' }
    }
    // For inline forms, fetch the bytes
    let res: Response
    try {
      res = await fetch(ref)
    } catch (e: any) {
      throw new ApiError('invalid_request', `failed to fetch reference URL: ${e?.message ?? e}`, 400)
    }
    if (!res.ok) {
      throw new ApiError('invalid_request', `reference URL returned HTTP ${res.status}`, 400)
    }
    const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream'
    const buf = Buffer.from(await res.arrayBuffer())
    if (form === 'inline-base64') {
      return { form, base64: buf.toString('base64'), mimeType }
    }
    return { form, bytes: buf, mimeType }
  }

  // --- data URI: parse and use directly ---
  if (ref.startsWith('data:')) {
    const match = ref.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) {
      throw new ApiError('invalid_request', `malformed data URI in input_assets`, 400)
    }
    const mimeType = match[1]
    const b64 = match[2]
    if (form === 'url') {
      // Can't serve a data URI as a URL — return it as-is for callers that handle data URIs
      return { form: 'url', url: ref, mimeType }
    }
    if (form === 'inline-base64') {
      return { form, base64: b64, mimeType }
    }
    return { form, bytes: Buffer.from(b64, 'base64'), mimeType }
  }

  // --- ast_… ID: look up in local asset store ---
  const tmpDir = process.env.ASSET_TMP_DIR ?? env.ASSET_TMP_DIR
  const a = await readAsset(tmpDir, ref)
  if (!a) {
    throw new ApiError(
      'invalid_request',
      `reference asset ${ref} not found or expired`,
      400,
    )
  }
  if (form === 'url') {
    const secret = process.env.ASSET_SIGNING_SECRET ?? env.ASSET_SIGNING_SECRET
    const publicUrl = process.env.ROUTER_PUBLIC_URL ?? env.ROUTER_PUBLIC_URL
    const expires = Math.floor(Date.now() / 1000) + 600
    const sig = signAssetUrl(ref, expires, secret)
    return {
      form,
      url: `${publicUrl}/v1/assets/${ref}?expires=${expires}&sig=${sig}`,
      mimeType: a.mimeType,
    }
  }
  if (form === 'inline-base64') {
    return { form, base64: a.bytes.toString('base64'), mimeType: a.mimeType }
  }
  return { form, bytes: a.bytes, mimeType: a.mimeType }
}
