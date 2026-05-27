import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { newAssetId, signAssetUrl, storeAsset } from '../assets.js'
import { env } from '../env.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const uploadsRoute = new OpenAPIHono()

/** 50 MB — matches nginx client_max_body_size */
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

/** Allowed MIME type prefixes/exact values */
const ALLOWED_MIME_PREFIXES = ['image/', 'video/', 'audio/']
const ALLOWED_MIME_EXACT = new Set(['application/pdf'])

function isMimeAllowed(mime: string): boolean {
  if (ALLOWED_MIME_EXACT.has(mime)) return true
  return ALLOWED_MIME_PREFIXES.some(p => mime.startsWith(p))
}

const uploadsPostRoute = createRoute({
  method: 'post',
  path: '/uploads',
  tags: ['uploads'],
  summary: 'Upload a file asset',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.instanceof(File).openapi({ type: 'string', format: 'binary' }),
          }),
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Asset uploaded successfully',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Missing or invalid file field, file too large, or disallowed MIME type',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

uploadsRoute.openapi(uploadsPostRoute, async c => {
  const form = await c.req.parseBody()
  const file = form['file']
  if (!(file instanceof File)) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', 'file field required', 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }

  // MIME allowlist check (before reading into memory)
  const mimeType = file.type || 'application/octet-stream'
  if (!isMimeAllowed(mimeType)) {
    const { status, body } = toErrorResponse(
      new ApiError('invalid_request', `unsupported file type: ${mimeType} (allowed: image/*, video/*, audio/*, application/pdf)`, 400),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }

  // Size check via File.size before reading into memory
  if (file.size > MAX_UPLOAD_BYTES) {
    const { status, body } = toErrorResponse(
      new ApiError('invalid_request', `file too large (max 50MB, got ${(file.size / 1024 / 1024).toFixed(1)}MB)`, 400),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }

  const buf = Buffer.from(await file.arrayBuffer())

  // Belt-and-suspenders: also check the actual buffer length
  if (buf.length > MAX_UPLOAD_BYTES) {
    const { status, body } = toErrorResponse(
      new ApiError('invalid_request', 'file too large (max 50MB)', 400),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }

  const id = newAssetId()
  const expires = Math.floor(Date.now() / 1000) + env.ASSET_TTL_SECONDS
  // Read ASSET_TMP_DIR at request time so tests can override via process.env
  const assetTmpDir = process.env.ASSET_TMP_DIR ?? env.ASSET_TMP_DIR
  const stored = await storeAsset(assetTmpDir, id, buf, mimeType)
  const sig = signAssetUrl(id, expires, env.ASSET_SIGNING_SECRET)
  const url = `${env.ROUTER_PUBLIC_URL}/v1/assets/${id}?expires=${expires}&sig=${sig}`
  return c.json({
    asset_id: id,
    url,
    expires_at: new Date(expires * 1000).toISOString(),
    mime_type: stored.mimeType,
    size_bytes: stored.sizeBytes,
  })
})
