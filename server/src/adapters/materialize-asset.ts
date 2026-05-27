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

export async function materializeAsset(assetId: string, form: AssetForm): Promise<MaterializedAsset> {
  const tmpDir = process.env.ASSET_TMP_DIR ?? env.ASSET_TMP_DIR
  const a = await readAsset(tmpDir, assetId)
  if (!a) {
    throw new ApiError(
      'invalid_request',
      `reference asset ${assetId} not found or expired`,
      400,
    )
  }
  if (form === 'url') {
    const secret = process.env.ASSET_SIGNING_SECRET ?? env.ASSET_SIGNING_SECRET
    const publicUrl = process.env.ROUTER_PUBLIC_URL ?? env.ROUTER_PUBLIC_URL
    const expires = Math.floor(Date.now() / 1000) + 600
    const sig = signAssetUrl(assetId, expires, secret)
    return {
      form,
      url: `${publicUrl}/v1/assets/${assetId}?expires=${expires}&sig=${sig}`,
      mimeType: a.mimeType,
    }
  }
  if (form === 'inline-base64') {
    return { form, base64: a.bytes.toString('base64'), mimeType: a.mimeType }
  }
  return { form, bytes: a.bytes, mimeType: a.mimeType }
}
