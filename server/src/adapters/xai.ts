/**
 * xAI Adapter (Grok models)
 *
 * Supported models:
 *   Image (sync):   grok-imagine  → upstream "grok-imagine-image-quality"
 *   Video (async):  grok-video    → upstream "grok-imagine-video" (native xAI video API)
 *   Audio TTS:      grok-tts      → upstream "grok-2-tts-1" (returns binary audio bytes)
 *
 * Auth: Authorization: Bearer ${XAI_API_KEY}
 * Base: https://api.x.ai/v1
 *
 * Video API shape (verified 2026-05-27):
 *   Submit: POST /v1/videos/generations → { request_id }
 *   Poll:   GET  /v1/videos/{request_id} → { status: "pending"|"processing"|"succeeded"|"failed", progress, video_url? }
 */

import type { Adapter, AsyncResult, SyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import type { AudioSpeechRequest } from '../schemas/audio-speech.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://api.x.ai/v1'

/** Poll interval for grok-imagine-video tasks (seconds are estimated at ~5s intervals) */
const XAI_VIDEO_POLL_AFTER_MS = 5_000

/** Map our image model IDs to xAI upstream model names */
const IMAGE_MODEL_MAP: Record<string, string> = {
  'grok-imagine': 'grok-imagine-image-quality',
}

/** Map our TTS model IDs to xAI upstream model names */
const TTS_MODEL_MAP: Record<string, string> = {
  'grok-tts': 'grok-2-tts-1',
}

export class XAIAdapter implements Adapter {
  readonly name = 'xai'

  constructor(private apiKey: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * JSON POST/GET helper — for requests that expect JSON responses.
   */
  private async callJson(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
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
      throw new ApiError('provider_unavailable', `xai network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `xAI ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }

    return parsed
  }

  /**
   * Binary POST helper — for TTS which returns raw audio bytes.
   */
  private async callBinary(path: string, body: unknown): Promise<{ bytes: Buffer; mimeType: string }> {
    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `xai network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }

    if (!res.ok) {
      const text = await res.text()
      let parsed: any
      try { parsed = JSON.parse(text) } catch { parsed = text }
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `xAI ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }

    const mimeType = res.headers.get('Content-Type') ?? 'audio/mpeg'
    const arrayBuf = await res.arrayBuffer()
    const bytes = Buffer.from(arrayBuf)
    return { bytes, mimeType }
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'grok-video' }>,
  ): Promise<AsyncResult> {
    const body: Record<string, unknown> = {
      model: 'grok-imagine-video',
      prompt: req.prompt,
      resolution: '720p',
    }

    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      body.image_url = m.url
    }

    const r: any = await this.callJson('POST', '/videos/generations', body)

    const requestId: string = r.request_id
    if (!requestId) {
      throw new ApiError('provider_unavailable', `xAI video response missing request_id: ${JSON.stringify(r)}`, 502, r)
    }

    return {
      status: 'queued',
      provider: 'xai',
      provider_task_id: requestId,
      poll_after_ms: XAI_VIDEO_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()

    const r: any = await this.callJson('GET', `/videos/${taskId}`)
    const status: string = (r.status ?? '').toLowerCase()

    if (status === 'succeeded' || status === 'completed') {
      const videoUrl: string = r.video_url ?? r.video?.url
      if (!videoUrl) {
        return {
          status: 'failed',
          error: { code: 'provider_unavailable', message: `xAI video succeeded but no video_url: ${JSON.stringify(r)}` },
          latency_ms: Date.now() - t0,
        }
      }
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: videoUrl, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'failed') {
      const msg = r.error ?? r.message ?? 'xAI video generation failed'
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: typeof msg === 'string' ? msg : JSON.stringify(msg),
          provider_raw: r,
        },
        latency_ms: Date.now() - t0,
      }
    }

    // pending / processing
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: XAI_VIDEO_POLL_AFTER_MS,
    }
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'grok-imagine' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const upstreamModel = IMAGE_MODEL_MAP[req.model] ?? req.model

    const r: any = await this.callJson('POST', '/images/generations', {
      model: upstreamModel,
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio ?? '16:9',
      resolution: '2k',
      n: 1,
    })

    return {
      status: 'succeeded',
      outputs: (r.data as Array<{ url?: string; b64_json?: string }>).map(d => ({
        kind: 'image' as const,
        url: d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined),
        mime_type: 'image/png',
      })),
      provider: 'xai',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async audioSpeech(
    req: Extract<AudioSpeechRequest, { model: 'grok-tts' }>,
  ): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string }> {
    const t0 = Date.now()
    const upstreamModel = TTS_MODEL_MAP[req.model] ?? req.model

    const { bytes, mimeType } = await this.callBinary('/audio/speech', {
      model: upstreamModel,
      input: req.input,
      voice: req.voice,
      response_format: req.response_format ?? 'mp3',
    })

    return {
      status: 'succeeded',
      bytes,
      mimeType,
      provider: 'xai',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }
}
