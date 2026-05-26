/**
 * Luma Adapter
 *
 * Image (sync): luma-uni-1 → team proxy at LUMA_PROXY_BASE_URL
 *   T2I: POST /v1/images/generate
 *   I2I: POST /v1/images/img2img  (when input_assets present)
 *   Response: { image_url } → SyncResult
 *   Auth: Bearer LUMA_PROXY_BEARER_TOKEN
 *
 * Video (async): luma-uni-1 → direct Luma AI API (kept for V1)
 *   POST https://api.lumalabs.ai/dream-machine/v1/generations
 *   Auth: Bearer LUMA_PROXY_BEARER_TOKEN (same token used for proxy)
 *
 * Ground truth: apps/backend/app/core/luma_images.py
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

/** Local type for luma-uni-1 image generation (model removed from images schema since it's video-only in V1 registry) */
type LumaImageRequest = {
  model: 'luma-uni-1'
  prompt: string
  aspectRatio?: '1:1' | '16:9' | '9:16' | '3:2' | '2:3'
  input_assets?: string[]
}

const VIDEO_BASE = 'https://api.lumalabs.ai/dream-machine/v1'
const LUMA_POLL_AFTER_MS = 5_000

const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '3:2', '2:3'])
const MAX_PROMPT_CHARS = 6000
const TRUNCATION_SUFFIX = '\n\n[truncated]'

function normalizeAspectRatio(ar: string): string {
  return SUPPORTED_ASPECT_RATIOS.has(ar) ? ar : '16:9'
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt
  const keep = MAX_PROMPT_CHARS - TRUNCATION_SUFFIX.length
  return prompt.slice(0, keep).trimEnd() + TRUNCATION_SUFFIX
}

export class LumaAdapter implements Adapter {
  readonly name = 'luma'

  private readonly bearerToken: string
  private readonly proxyBaseUrl: string

  constructor(config: { bearerToken: string; baseUrl: string }) {
    this.bearerToken = config.bearerToken
    this.proxyBaseUrl = config.baseUrl.replace(/\/$/, '')
  }

  private async callProxy(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res: Response
    try {
      res = await fetch(`${this.proxyBaseUrl}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `luma network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const message = parsed?.detail ?? parsed?.error?.message ?? parsed?.message ?? `Luma ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), toHttpStatus(res.status), parsed)
    }
    return parsed
  }

  private async callVideoApi(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    let res: Response
    try {
      res = await fetch(`${VIDEO_BASE}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `luma network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const message = parsed?.detail ?? parsed?.error?.message ?? parsed?.message ?? `Luma ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), toHttpStatus(res.status), parsed)
    }
    return parsed
  }

  async imageGeneration(
    req: LumaImageRequest,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const hasAssets = req.input_assets && req.input_assets.length > 0

    const payload: Record<string, unknown> = {
      prompt: truncatePrompt(req.prompt),
      aspect_ratio: normalizeAspectRatio(req.aspectRatio ?? '16:9'),
      output_format: 'png',
    }

    let endpoint = '/v1/images/generate'
    if (hasAssets) {
      const m = await materializeAsset(req.input_assets![0], 'url')
      endpoint = '/v1/images/img2img'
      payload.image_url = m.url
    }

    const r: any = await this.callProxy('POST', endpoint, payload)
    const imageUrl: string = r.image_url
    if (!imageUrl) {
      throw new ApiError('provider_unavailable', `Luma proxy returned no image_url: ${JSON.stringify(r)}`, 502, r)
    }

    return {
      status: 'succeeded',
      outputs: [{ kind: 'image', url: imageUrl, mime_type: 'image/png' }],
      provider: 'luma',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'luma-uni-1' }>,
  ): Promise<AsyncResult> {
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
    }

    if (req.input_assets && req.input_assets.length > 0) {
      const keyframes: Record<string, unknown> = {}
      if (req.input_assets[0]) {
        const m = await materializeAsset(req.input_assets[0], 'url')
        keyframes.frame0 = { type: 'image', url: m.url }
      }
      if (req.input_assets[1]) {
        const m = await materializeAsset(req.input_assets[1], 'url')
        keyframes.frame1 = { type: 'image', url: m.url }
      }
      body.keyframes = keyframes
    }

    const r: any = await this.callVideoApi('POST', '/generations', body)

    return {
      status: 'queued',
      provider: 'luma',
      provider_task_id: r.id as string,
      poll_after_ms: LUMA_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.callVideoApi('GET', `/generations/${taskId}`)
    const state: string = r.state

    if (state === 'failed') {
      return {
        status: 'failed',
        error: { code: 'provider_unavailable', message: r.failure_reason ?? r.error ?? 'Luma task failed', provider_raw: r },
        latency_ms: Date.now() - t0,
      }
    }
    if (state === 'queued' || state === 'dreaming') {
      return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: LUMA_POLL_AFTER_MS }
    }
    if (state === 'completed') {
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: r.assets?.video, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }
    return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: LUMA_POLL_AFTER_MS }
  }
}
