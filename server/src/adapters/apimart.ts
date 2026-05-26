/**
 * Apimart Adapter — gpt-image-2 proxy
 *
 * Supported models:
 *   Image (async): gpt-image-2
 *
 * Auth: Bearer ${APIMART_API_KEY}
 * Base: APIMART_BASE_URL (default https://api.apimart.ai)
 *
 * Ground truth: apps/backend/app/core/apimart_images.py
 *
 * Flow: POST /v1/images/generations → { data: [{ task_id }] }
 *       GET  /v1/tasks/{task_id}    → { data: { status, result: { images: [{url}] } } }
 */

import type { Adapter, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'

const APIMART_POLL_AFTER_MS = 5_000

const SUPPORTED_SIZES = new Set([
  'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '21:9', '9:21', '7:9', '9:7',
])

/**
 * Map our schema size strings (OpenAI-compatible WxH) to apimart's accepted
 * aspect-ratio strings (same set used by apimart_images.py).
 */
const SIZE_TO_ASPECT_RATIO: Record<string, string> = {
  '1024x1024': '1:1',
  '1792x1024': '16:9',
  '1024x1792': '9:16',
}

function sizeToAspectRatio(size: string): string {
  const ar = SIZE_TO_ASPECT_RATIO[size]
  if (ar && SUPPORTED_SIZES.has(ar)) return ar
  // fallback: if somehow an unrecognised size arrives, pass 'auto'
  return 'auto'
}

export class ApimartAdapter implements Adapter {
  readonly name = 'apimart'

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: { apiKey: string; baseUrl: string }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res: Response
    try {
      res = await fetch(`${this.baseUrl}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `apimart network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const err = parsed?.error ?? {}
      const message = err.message ?? `Apimart ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), toHttpStatus(res.status), parsed)
    }
    return parsed
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'gpt-image-2' }>,
  ): Promise<AsyncResult> {
    // Map schema size ('1024x1024' etc.) → apimart aspect-ratio string ('1:1' etc.)
    // Mirrors the mapping in apps/backend/app/core/apimart_images.py
    const size = sizeToAspectRatio(req.size)

    const body: Record<string, unknown> = {
      model: 'gpt-image-2',
      prompt: req.prompt,
      n: req.n,          // schema: 1-4, default 1
      size,
      resolution: '2k',
    }

    // I2I: pass image URLs from input_assets (mirrors apimart_images.py _submit)
    if (req.input_assets && req.input_assets.length > 0) {
      body.image_urls = req.input_assets
    }

    const r: any = await this.call('POST', '/v1/images/generations', body)

    const items = r.data ?? []
    const taskId: string = items[0]?.task_id
    if (!taskId) {
      throw new ApiError('provider_unavailable', `Apimart returned no task_id: ${JSON.stringify(r)}`, 502, r)
    }

    return {
      status: 'queued',
      provider: 'apimart',
      provider_task_id: taskId,
      poll_after_ms: APIMART_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/v1/tasks/${taskId}`)

    // Apimart wraps status under either top-level or `data`
    const node: any = (r.data && typeof r.data === 'object') ? r.data : r
    const status: string = (node.status ?? '').toLowerCase()

    if (status === 'completed') {
      const result = node.result ?? {}
      const images: Array<any> = result.images ?? []
      const urlField = images[0]?.url
      const url = Array.isArray(urlField) ? urlField[0] : urlField
      if (!url) {
        return {
          status: 'failed',
          error: { code: 'provider_unavailable', message: `Apimart completed but no image URL: ${JSON.stringify(r)}` },
          latency_ms: Date.now() - t0,
        }
      }
      return {
        status: 'succeeded',
        outputs: [{ kind: 'image', url, mime_type: 'image/png' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'failed') {
      const err = node.error ?? {}
      const msg = err.message ?? 'Apimart task failed'
      // Check if it's a moderation/rejection
      const isRejected = ['moderation', 'content policy', 'content_policy', 'safety', 'blocked', 'restriction', 'policy violation']
        .some(kw => msg.toLowerCase().includes(kw))
      return {
        status: 'failed',
        error: {
          code: isRejected ? 'provider_rejected' : 'provider_unavailable',
          message: msg,
          provider_raw: node.error,
        },
        latency_ms: Date.now() - t0,
      }
    }

    // pending / processing / unknown → still running
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: APIMART_POLL_AFTER_MS,
    }
  }
}
