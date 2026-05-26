import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { newAssetId, signAssetUrl, storeAsset } from '../assets.js'
import { env } from '../env.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const uploadsRoute = new OpenAPIHono()

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
      description: 'Missing or invalid file field',
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
  const buf = Buffer.from(await file.arrayBuffer())
  const id = newAssetId()
  const expires = Math.floor(Date.now() / 1000) + env.ASSET_TTL_SECONDS
  // Read ASSET_TMP_DIR at request time so tests can override via process.env
  const assetTmpDir = process.env.ASSET_TMP_DIR ?? env.ASSET_TMP_DIR
  const stored = await storeAsset(assetTmpDir, id, buf, file.type || 'application/octet-stream')
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
