/**
 * Tokenrouter Adapter (OpenAI-compatible router)
 *
 * Tokenrouter is an OpenAI-compatible API router that provides access to various
 * LLM and video generation models.
 *
 * Supported models:
 *   Chat (sync):   qwen-3-6-plus, gpt-5.5-pro, gemini-3.1-pro, gemini-3-flash
 *   Video (async): seedance-2.0  → dreamina-seedance-2-0-260128
 *                  seedance-2.0-fast → dreamina-seedance-2-0-fast-260128
 *
 * Auth: Authorization: Bearer ${TOKENROUTER_API_KEY}
 * Base: https://api.tokenrouter.com/v1
 *
 * Video API (OpenAI Videos pattern):
 *   POST /v1/videos  { model, prompt, size, seconds }  → { task_id }
 *   GET  /v1/videos/{id}  → { status, metadata: { url } }
 *   status values: "pending" | "running" | "completed" | "failed"
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ChatCompletionsRequest } from '../schemas/chat-completions.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://api.tokenrouter.com/v1'

const SEEDANCE_POLL_AFTER_MS = 8_000

/**
 * Map our chat model IDs to Tokenrouter upstream model names.
 * Source: apps/backend/app/core/config.py (tokenrouter.py normalize_tokenrouter_model_name)
 */
const CHAT_MODEL_MAP: Record<string, string> = {
  'qwen-3-6-plus':  'qwen/qwen3.6-plus',
  'gpt-5.5-pro':    'openai/gpt-5.5',
  'gemini-3.1-pro': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash': 'google/gemini-3-flash-preview',
}

/**
 * Map our video model IDs to Tokenrouter dreamina upstream model names.
 * Verified live: tokenrouter serves dreamina-seedance-2-0-260128 via OpenAI Videos API.
 */
const VIDEO_MODEL_MAP: Record<string, string> = {
  'seedance-2.0':      'dreamina-seedance-2-0-260128',
  'seedance-2.0-fast': 'dreamina-seedance-2-0-fast-260128',
}

/**
 * Map our aspect ratio + resolution to a WxH size string for the tokenrouter videos API.
 * Supports three resolution tiers: 480p / 720p / 1080p.
 * ASSUMPTION: the dreamina/tokenrouter Videos API accepts 1080p WxH strings
 * (e.g. '1920x1080') — unverified until live smoke test.
 */
function seedanceSize(req: { ratio?: string; resolution?: string }): string {
  const ratio = req.ratio ?? '16:9'
  const res = req.resolution ?? '720p'
  const tier: '480p' | '720p' | '1080p' = (res === '480p' || res === '1080p') ? res : '720p'
  const sizeMap: Record<string, { '480p': string; '720p': string; '1080p': string }> = {
    '16:9':  { '480p': '854x480',   '720p': '1280x720',  '1080p': '1920x1080' },
    '9:16':  { '480p': '480x854',   '720p': '720x1280',  '1080p': '1080x1920' },
    '1:1':   { '480p': '480x480',   '720p': '720x720',   '1080p': '1080x1080' },
    '4:3':   { '480p': '640x480',   '720p': '960x720',   '1080p': '1440x1080' },
    '3:4':   { '480p': '480x640',   '720p': '720x960',   '1080p': '1080x1440' },
  }
  const fallbacks: Record<'480p' | '720p' | '1080p', string> = {
    '480p': '854x480', '720p': '1280x720', '1080p': '1920x1080',
  }
  return sizeMap[ratio]?.[tier] ?? fallbacks[tier]
}

export class TokenrouterAdapter implements Adapter {
  readonly name = 'tokenrouter'

  constructor(private apiKey: string) {}

  private upstreamChatModel(model: string): string {
    return CHAT_MODEL_MAP[model] ?? model
  }

  private async callJson(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
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
      res = await fetch(`${BASE}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `tokenrouter network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }

    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Tokenrouter ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }

    return parsed
  }

  async chatCompletion(
    req: ChatCompletionsRequest,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const parsed: any = await this.callJson('POST', '/chat/completions', {
      model: this.upstreamChatModel(req.model),
      messages: req.messages,
      temperature: req.temperature,
      stream: false,
    })

    return {
      status: 'succeeded',
      outputs: [{ kind: 'text', text: parsed.choices[0].message.content }],
      provider: 'tokenrouter',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'seedance-2.0' | 'seedance-2.0-fast' }>,
  ): Promise<AsyncResult> {
    const upstreamModel = VIDEO_MODEL_MAP[req.model] ?? req.model
    const size = seedanceSize(req)
    // tokenrouter Videos API: seconds is a string (per their Go struct definition)
    const seconds = req.duration ? String(req.duration) : '5'

    const body: Record<string, unknown> = {
      model: upstreamModel,
      prompt: req.prompt,
      size,
      seconds,
    }

    // I2V / V2V: pass reference image or video as a URL. Mode inferred from MIME —
    // video/* → v2v, everything else → image (raw http(s) URLs materialize as
    // application/octet-stream per materialize-asset.ts:30, so they default to
    // image, mirroring xai.ts:172-176; don't invert this).
    // ASSUMPTION: dreamina's OpenAI-style Videos API accepts a `video_url` field
    // for video-to-video (unverified until live smoke test).
    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      if (m.mimeType.startsWith('video/')) {
        body.video_url = m.url
      } else {
        body.image_url = m.url
      }
    }

    const r: any = await this.callJson('POST', '/videos', body)

    return {
      status: 'queued',
      provider: 'tokenrouter',
      provider_task_id: r.task_id as string,
      poll_after_ms: SEEDANCE_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.callJson('GET', `/videos/${taskId}`)

    const status: string = r.status ?? 'unknown'

    if (status === 'completed') {
      const videoUrl: string = r.metadata?.url ?? r.url
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: videoUrl, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'pending' || status === 'running' || status === 'in_progress') {
      return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: SEEDANCE_POLL_AFTER_MS }
    }

    // failed or unknown
    const errMsg: string = r.error?.message ?? r.message ?? `Tokenrouter video task ${status}`
    return {
      status: 'failed',
      error: {
        code: 'provider_unavailable',
        message: errMsg,
        provider_raw: r.error ?? r,
      },
      latency_ms: Date.now() - t0,
    }
  }
}
