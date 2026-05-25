import { Hono } from 'hono'
import { env } from '../env.js'
import { readAsset, verifyAssetSig } from '../assets.js'

export const assetsRoute = new Hono()

assetsRoute.get('/assets/:id', async c => {
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
