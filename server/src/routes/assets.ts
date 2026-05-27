import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { env } from '../env.js'
import { readAsset, verifyAssetSig } from '../assets.js'

export const assetsRoute = new OpenAPIHono()

const assetsGetRoute = createRoute({
  method: 'get',
  path: '/assets/{id}',
  tags: ['assets'],
  summary: 'Retrieve a signed asset by ID',
  security: [],
  request: {
    params: z.object({
      id: z.string().openapi({ description: 'Asset ID' }),
    }),
    query: z.object({
      expires: z.string().openapi({ description: 'Unix timestamp expiry' }),
      sig: z.string().openapi({ description: 'HMAC signature' }),
    }),
  },
  responses: {
    200: {
      description: 'Asset binary',
      content: { 'application/octet-stream': { schema: z.any() } },
    },
    403: {
      description: 'Bad signature or expired',
      content: { 'application/json': { schema: z.any() } },
    },
    404: {
      description: 'Asset not found',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

assetsRoute.openapi(assetsGetRoute, async c => {
  const id = c.req.param('id')
  const expires = Number(c.req.query('expires'))
  const sig = c.req.query('sig') ?? ''
  const secret = process.env.ASSET_SIGNING_SECRET ?? env.ASSET_SIGNING_SECRET
  if (!verifyAssetSig(id, expires, sig, secret)) {
    return c.json({ status: 'failed', error: { code: 'invalid_request', message: 'bad signature or expired' } }, 403)
  }
  const tmpDir = process.env.ASSET_TMP_DIR ?? env.ASSET_TMP_DIR
  const a = await readAsset(tmpDir, id)
  if (!a) {
    return c.json({ status: 'failed', error: { code: 'invalid_request', message: 'asset not found' } }, 404)
  }
  return new Response(a.bytes, { headers: { 'Content-Type': a.mimeType } })
})
