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

// Matches a pathname that is EXACTLY /v1/assets/ast_<hex-id> (optional trailing
// slash) — the precise shape the router emits (uploads.ts, gemini.ts, and the
// re-signed URL below). We match on the PATH ONLY, not the host/origin, because
// a hostname migration is pending (nip.io → router.storyverseai.art) and clients
// may still hold URLs issued under the old host — path-matching survives that.
// The regex is anchored (^…$) so an external URL that merely CONTAINS the segment
// (e.g. https://evil.com/redirect/v1/assets/ast_x, or .../ast_x/raw) is NOT
// hijacked into a store lookup; combined with readAsset's own prefix matching,
// an unanchored pattern would be a false-positive foot-gun.
const ROUTER_ASSET_PATH_RE = /^\/v1\/assets\/(ast_[0-9a-f]+)\/?$/

/**
 * Materialize an asset reference into the requested form.
 *
 * Accepts four input shapes:
 *   - router-issued signed URL (…/v1/assets/ast_<id>?expires=…&sig=…)
 *                → extract ast_id and resolve via local store (real MIME)
 *   - http(s):// URL  → already a public URL; use directly (or fetch for inline forms)
 *   - data:<mime>;base64,<...>  → inline data URI; parse and use directly
 *   - ast_… ID        → look up in local asset store (existing behavior)
 *
 * This means callers can pass a raw public URL in input_assets and it will
 * be forwarded as-is (form=url) or fetched (form=inline-*).
 */
export async function materializeAsset(ref: string, form: AssetForm): Promise<MaterializedAsset> {
  // --- router-issued signed URL: extract ast_id and resolve via local store ---
  // Must be checked BEFORE the generic http(s) branch so router URLs get the
  // real stored MIME type (e.g. video/mp4) instead of application/octet-stream.
  if (ref.startsWith('http://') || ref.startsWith('https://')) {
    let parsedUrl: URL | null = null
    try {
      parsedUrl = new URL(ref)
    } catch {
      // Not a valid URL — fall through to generic http(s) handling below
    }

    if (parsedUrl) {
      const m = parsedUrl.pathname.match(ROUTER_ASSET_PATH_RE)
      if (m) {
        // This is a router-issued signed URL — resolve via asset store to get
        // the real MIME type. Re-use the ast_… branch by delegating to a tail call.
        return materializeAsset(m[1], form)
      }
    }
  }

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
