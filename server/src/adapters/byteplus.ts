/**
 * Byteplus ModelArk Adapter — Volcengine Beijing region
 *
 * Supported models:
 *   Image (sync):  seedream-4.5, seedream-5.0
 *   Video (async): seedance-2.0, seedance-2.0-fast
 *
 * Auth: Bearer ${BYTEPLUS_API_KEY}  (ark-... token)
 * Base: https://ark.cn-beijing.volces.com/api/v3
 *
 * Ground truth: apps/backend/app/core/volcengine_images.py (Seedream)
 *               apps/backend/app/workers/providers/volcengine.py (Seedance)
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://ark.cn-beijing.volces.com/api/v3'

const SEEDANCE_POLL_AFTER_MS = 5_000
const MIN_SEEDREAM_PIXELS = 3_686_400

/**
 * Resolution + aspect ratio → pixel size mapping for Seedream image generation.
 * Mirrors plugin src/providers/seedream.ts SIZE_MAP (ground truth: bytedance Volcengine API).
 * seedream-4.5 supports: 2K, 4K.
 * seedream-5.0 supports: 2K, 3K.
 */
const SEEDREAM_SIZE_MAP: Record<string, Record<string, string>> = {
  '1K': { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1280x720', '9:16': '720x1280', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1512x648' },
  '2K': { '1:1': '2048x2048', '4:3': '2304x1728', '3:4': '1728x2304', '16:9': '2848x1600', '9:16': '1600x2848', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' },
  '3K': { '1:1': '3072x3072', '4:3': '3456x2592', '3:4': '2592x3456', '16:9': '4096x2304', '9:16': '2304x4096', '3:2': '3744x2496', '2:3': '2496x3744', '21:9': '4704x2016' },
  '4K': { '1:1': '4096x4096', '4:3': '4704x3520', '3:4': '3520x4704', '16:9': '5504x3040', '9:16': '3040x5504', '3:2': '4992x3328', '2:3': '3328x4992', '21:9': '6240x2656' },
}

/**
 * Resolve seedream resolution + aspectRatio → WxH size string.
 * When resolution is provided (new path), uses SEEDREAM_SIZE_MAP.
 * Falls back to the existing aspectRatioToSeeadreamSize computation when
 * resolution is absent (back-compat for callers that don't send resolution).
 */
export function seedreamSizeFromResolution(resolution: string, aspectRatio: string): string {
  const tierMap = SEEDREAM_SIZE_MAP[resolution]
  if (tierMap) {
    return tierMap[aspectRatio] ?? tierMap['1:1'] ?? aspectRatioToSeeadreamSize(aspectRatio)
  }
  // Fallback to dynamic computation for any tier not in the static map
  return aspectRatioToSeeadreamSize(aspectRatio)
}

/** Map our model IDs to Volcengine doubao upstream model names */
const MODEL_MAP: Record<string, string> = {
  'seedream-4.5':       'doubao-seedream-4-5-251128',
  'seedream-5.0':       'doubao-seedream-5-0-260128',
  'seedance-2.0':       'doubao-seedance-2-0-260128',
  'seedance-2.0-fast':  'doubao-seedance-2-0-fast-260128',
}

/**
 * Volcengine Ark error codes → our error types.
 * Source: apps/backend/app/workers/providers/volcengine.py VOLCENGINE_ERROR_CODES
 */
const VOLCENGINE_ERROR_CODES: Record<string, { message: string; kind: 'rejected' | 'unavailable' | 'quota' }> = {
  'SensitiveContentDetected':                                { message: 'Sensitive content detected', kind: 'rejected' },
  'InputTextSensitiveContentDetected':                       { message: 'Input text contains sensitive content', kind: 'rejected' },
  'InputImageSensitiveContentDetected':                      { message: 'Input image contains sensitive content', kind: 'rejected' },
  'InputVideoSensitiveContentDetected':                      { message: 'Input video contains sensitive content', kind: 'rejected' },
  'OutputVideoSensitiveContentDetected':                     { message: 'Output video contains sensitive content', kind: 'rejected' },
  'OutputAudioSensitiveContentDetected':                     { message: 'Output audio contains sensitive content', kind: 'rejected' },
  'OutputVideoSensitiveContentDetected.PolicyViolation':     { message: 'Output video copyright restriction', kind: 'rejected' },
  'InputImageSensitiveContentDetected.PrivacyInformation':   { message: 'Input image may contain real person', kind: 'rejected' },
  'QuotaExceeded':         { message: 'Quota exhausted', kind: 'quota' },
  'ServerOverloaded':      { message: 'Server overloaded', kind: 'unavailable' },
  'InternalServiceError':  { message: 'Internal service error', kind: 'unavailable' },
}

/**
 * Translate our canonical aspect ratio string into an explicit WxH size.
 * Seedream 5.0 enforces a 3,686,400-pixel minimum.
 * Logic mirrors volcengine_images.py aspect_ratio_to_seedream_size().
 */
export function aspectRatioToSeeadreamSize(aspectRatio: string): string {
  let widthRatio = 16
  let heightRatio = 9
  try {
    const parts = aspectRatio.split(':')
    if (parts.length === 2) {
      const w = parseInt(parts[0], 10)
      const h = parseInt(parts[1], 10)
      if (w > 0 && h > 0) { widthRatio = w; heightRatio = h }
    }
  } catch { /* use defaults */ }

  const longR = Math.max(widthRatio, heightRatio)
  const shortR = Math.min(widthRatio, heightRatio)

  const minLong = Math.sqrt(MIN_SEEDREAM_PIXELS * longR / shortR)
  let longSide = Math.max(2560, Math.ceil(minLong / 64) * 64)
  let shortSide = Math.max(512, Math.ceil(longSide * shortR / longR / 64) * 64)

  longSide = Math.min(longSide, 4096)
  shortSide = Math.min(shortSide, 4096)

  if (widthRatio >= heightRatio) {
    return `${longSide}x${shortSide}`
  }
  return `${shortSide}x${longSide}`
}

export class ByteplusAdapter implements Adapter {
  readonly name = 'byteplus'

  constructor(private config: {
    apiKey: string
    accessKey: string
    secretKey: string
    project: string
  }) {}

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `byteplus network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Byteplus ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }

    return parsed
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'seedream-4.5' | 'seedream-5.0' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const upstreamModel = MODEL_MAP[req.model] ?? req.model
    const aspectRatio = req.aspectRatio ?? '16:9'
    // resolution field added for plugin parity:
    //   seedream-4.5: 2K | 4K (default 2K)
    //   seedream-5.0: 2K | 3K (default 2K)
    // When present use SEEDREAM_SIZE_MAP; fall back to the dynamic computation
    // for callers that omit resolution (back-compat).
    const resolution = (req as any).resolution as string | undefined
    const size = resolution
      ? seedreamSizeFromResolution(resolution, aspectRatio)
      : aspectRatioToSeeadreamSize(aspectRatio)

    const body: Record<string, unknown> = {
      model: upstreamModel,
      prompt: req.prompt,
      response_format: 'url',
      stream: false,
      watermark: false,
      size,
      n: req.n ?? 1,  // schema: 1-4, default 1
    }

    // I2I: pass image as a signed public URL so Volcengine can fetch it.
    // Volcengine's seedream `image` field requires a fetchable URL — raw base64
    // causes "invalid url specified" (confirmed by Zhizhuo's test 2026-05-27).
    // Signed asset URLs are publicly accessible (ROUTER_PUBLIC_URL is HTTPS).
    // This mirrors how seedance (same Volcengine) passes image_url references.
    if (req.input_assets && req.input_assets.length > 0) {
      const resolved = await Promise.all(
        req.input_assets.map(async (id) => {
          const m = await materializeAsset(id, 'url')
          return m.url as string
        })
      )
      body.image = resolved.length === 1 ? resolved[0] : resolved
    }

    const r: any = await this.call('POST', '/images/generations', body)

    const outputs = (r.data as Array<{ url?: string }>).map(d => ({
      kind: 'image' as const,
      url: d.url,
      mime_type: 'image/jpeg',
    }))

    return {
      status: 'succeeded',
      outputs,
      provider: 'byteplus',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'seedance-2.0' | 'seedance-2.0-fast' }>,
  ): Promise<AsyncResult> {
    const upstreamModel = MODEL_MAP[req.model] ?? req.model

    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: req.prompt },
    ]

    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      // Mode is inferred from MIME: video/* → video-ref (v2v), everything else
      // → image-ref (i2v). Raw http(s) URLs materialize as application/octet-stream
      // (materialize-asset.ts:30) and so default to image — matching the xai
      // adapter's documented fallthrough (xai.ts:172-176). Do NOT invert this to
      // default unknown MIME to video, or URL-form i2v inputs break.
      if (m.mimeType.startsWith('video/')) {
        content.push({
          type: 'video_url',
          video_url: { url: m.url },
          role: 'reference_video',
        })
      } else {
        content.push({
          type: 'image_url',
          image_url: { url: m.url },
          role: 'reference_image',
        })
      }
    }

    const body: Record<string, unknown> = {
      model: upstreamModel,
      content,
      ratio: req.ratio ?? '16:9',
      duration: req.duration ? Number(req.duration) : -1,
      generate_audio: req.generate_audio ?? true,
    }

    if (req.resolution) body.resolution = req.resolution

    const r: any = await this.call('POST', '/contents/generations/tasks', body)

    return {
      status: 'queued',
      provider: 'byteplus',
      provider_task_id: r.id as string,
      poll_after_ms: SEEDANCE_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/contents/generations/tasks/${taskId}`)

    const status: string = r.status

    if (status === 'succeeded') {
      const videoUrl: string = r.content?.video_url
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: videoUrl, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'queued' || status === 'preparing' || status === 'running') {
      return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: SEEDANCE_POLL_AFTER_MS }
    }

    // failed or unknown — check error codes
    const errorObj = r.error ?? {}
    const vcCode: string = errorObj.code ?? ''
    const vcMsg: string = errorObj.message ?? `Seedance task ${status}`

    const entry = VOLCENGINE_ERROR_CODES[vcCode]
    if (entry) {
      const code = entry.kind === 'rejected' ? 'provider_rejected'
        : entry.kind === 'quota' ? 'quota_exceeded'
        : 'provider_unavailable'
      return {
        status: 'failed',
        error: { code, message: entry.message, provider_raw: r.error },
        latency_ms: Date.now() - t0,
      }
    }

    return {
      status: 'failed',
      error: {
        code: 'provider_unavailable',
        message: vcCode ? `[${vcCode}] ${vcMsg}` : vcMsg,
        provider_raw: r.error,
      },
      latency_ms: Date.now() - t0,
    }
  }
}
