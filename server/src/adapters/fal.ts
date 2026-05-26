/**
 * Fal Adapter (fal.ai — multi-model wrapper)
 *
 * Supported models (all async via fal queue API):
 *   Video:        kling-2.6, kling-3.0, grok-video
 *   Audio (music): elevenlabs-music
 *   Audio (sfx):   elevenlabs-sfx
 *   Audio (TTS):   elevenlabs-tts-v3 (queue-based, returns AsyncResult)
 *
 * Auth: Authorization: Key ${FAL_API_KEY}
 * Base: https://queue.fal.run
 *
 * CONCERNS / ASSUMPTIONS:
 *   1. Model paths are best guesses based on fal.ai naming conventions.
 *      Live smoke (Task 31) must confirm:
 *        kling-2.6  → fal-ai/kling-video/v2.6/text-to-video (or image-to-video)
 *        kling-3.0  → fal-ai/kling-video/v3/text-to-video (or image-to-video)
 *        grok-video → fal-ai/grok-video (xai-hosted; exact path TBD)
 *        elevenlabs-music → fal-ai/elevenlabs/music
 *        elevenlabs-sfx   → fal-ai/elevenlabs/sound-effects
 *        elevenlabs-tts-v3 → fal-ai/elevenlabs/tts/v3
 *   2. provider_task_id encodes model path + request_id as "${modelPath}|${requestId}"
 *      so taskStatus() can reconstruct the correct poll URL. This is a V1 hack;
 *      a proper task store should replace this.
 *   3. audioSpeech returns AsyncResult (not sync bytes) because fal TTS is queue-based.
 *      types.ts has been updated to allow this widened return type.
 *   4. Kling image-to-video: when input_assets present, we use the first asset as
 *      image_url. The field name (image_url vs. image) may differ from live API.
 *   5. Audio result shape assumed: { audio: { url, content_type } }. May differ per model.
 */

import type { Adapter, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import type { AudioMusicRequest } from '../schemas/audio-music.js'
import type { AudioSfxRequest } from '../schemas/audio-sfx.js'
import type { AudioSpeechRequest } from '../schemas/audio-speech.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://queue.fal.run'

/** How long callers should wait before polling fal queue tasks (5 seconds) */
const FAL_POLL_AFTER_MS = 5_000

/**
 * Model path map.
 * For video models that support both T2V and I2V, t2vPath / i2vPath are used.
 * For audio models, path is used directly.
 *
 * ASSUMPTION: These paths follow fal.ai conventions. Confirm via live smoke.
 */
interface ModelEntry {
  path: string
  t2vPath?: string
  i2vPath?: string
}

const MODEL_MAP: Record<string, ModelEntry> = {
  'kling-2.6': {
    path: 'fal-ai/kling-video/o3/pro/reference-to-video',
    t2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
    i2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
  },
  'kling-3.0': {
    path: 'fal-ai/kling-video/o3/pro/reference-to-video',
    t2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
    i2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
  },
  'grok-video': {
    path: 'xai/grok-imagine-video/image-to-video',
    t2vPath: 'xai/grok-imagine-video/image-to-video',
    i2vPath: 'xai/grok-imagine-video/image-to-video',
  },
  'elevenlabs-music': {
    path: 'fal-ai/elevenlabs/music',
  },
  'elevenlabs-sfx': {
    path: 'fal-ai/elevenlabs/sound-effects',
  },
  'elevenlabs-tts-v3': {
    path: 'fal-ai/elevenlabs/tts/v3',
  },
  // Image models
  'nano-banana-pro': {
    path: 'fal-ai/nano-banana-pro',
    t2vPath: 'fal-ai/nano-banana-pro',
    i2vPath: 'fal-ai/nano-banana-pro/edit',
  },
  'nano-banana-2': {
    path: 'fal-ai/nano-banana-2',
    t2vPath: 'fal-ai/nano-banana-2',
    i2vPath: 'fal-ai/nano-banana-2/edit',
  },
}

export class FalAdapter implements Adapter {
  readonly name = 'fal'

  constructor(private apiKey: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Key ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined && body !== null) {
      init.body = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await fetch(`${BASE}${path}`, init)
    } catch (e: any) {
      throw new ApiError('provider_unavailable', `fal network error: ${e?.message ?? e}`, 503, { transport_error: String(e?.message ?? e) })
    }
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      // fal uses 'detail' field for error messages in some responses
      const message =
        parsed?.detail ??
        parsed?.error?.message ??
        parsed?.message ??
        `Fal ${res.status}`
      throw new ApiError(
        code,
        typeof message === 'string' ? message : JSON.stringify(message),
        toHttpStatus(res.status),
        parsed,
      )
    }

    return parsed
  }

  /**
   * Submit a job to the fal queue and return a provider_task_id that encodes
   * the model path so taskStatus() can reconstruct the poll URL.
   *
   * Encoding: "${modelPath}|${request_id}"
   * (V1 hack — replace with a task store in a future iteration)
   */
  private async submitToQueue(modelPath: string, body: Record<string, unknown>): Promise<AsyncResult> {
    const r: any = await this.call('POST', `/${modelPath}`, body)
    const requestId: string = r.request_id
    return {
      status: 'queued',
      provider: 'fal',
      provider_task_id: `${modelPath}|${requestId}`,
      poll_after_ms: FAL_POLL_AFTER_MS,
    }
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'nano-banana-pro' | 'nano-banana-2' }>,
  ): Promise<AsyncResult> {
    const entry = MODEL_MAP[req.model]
    if (!entry) {
      throw new ApiError('provider_invalid_request', `Unknown fal image model: ${req.model}`, 400, null)
    }

    const hasAssets = req.input_assets && req.input_assets.length > 0
    const modelPath = hasAssets ? (entry.i2vPath ?? entry.path) : (entry.t2vPath ?? entry.path)

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      num_images: 1,
      aspect_ratio: req.aspectRatio ?? '16:9',
      output_format: 'png',
    }

    if (hasAssets) {
      const urls: string[] = []
      for (const asset of req.input_assets!) {
        const m = await materializeAsset(asset, 'url')
        if (m.url) urls.push(m.url)
      }
      body.image_urls = urls
    }

    return this.submitToQueue(modelPath, body)
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'kling-2.6' | 'kling-3.0' | 'grok-video' }>,
  ): Promise<AsyncResult> {
    const entry = MODEL_MAP[req.model]
    if (!entry) {
      throw new ApiError('provider_invalid_request', `Unknown fal video model: ${req.model}`, 400, null)
    }

    const hasAssets = req.input_assets && req.input_assets.length > 0
    const modelPath = hasAssets ? (entry.i2vPath ?? entry.path) : (entry.t2vPath ?? entry.path)

    const body: Record<string, unknown> = {
      prompt: req.prompt,
    }

    if ('duration' in req && req.duration) {
      body.duration = Number(req.duration)
    }

    if ('aspectRatio' in req && req.aspectRatio) {
      body.aspect_ratio = req.aspectRatio
    }

    if ('generate_audio' in req && req.generate_audio !== undefined) {
      body.generate_audio = req.generate_audio
    }

    if (hasAssets) {
      if (req.model === 'grok-video') {
        const m = await materializeAsset(req.input_assets![0], 'url')
        body.image_url = m.url
        body.resolution = '720p'
      } else {
        // kling: image_urls array
        const urls: string[] = []
        for (const asset of req.input_assets!) {
          const m = await materializeAsset(asset, 'url')
          if (m.url) urls.push(m.url)
        }
        body.image_urls = urls
      }
    }

    return this.submitToQueue(modelPath, body)
  }

  async audioMusic(req: AudioMusicRequest): Promise<AsyncResult> {
    const entry = MODEL_MAP[req.model]
    if (!entry) {
      throw new ApiError('provider_invalid_request', `Unknown fal audio model: ${req.model}`, 400, null)
    }

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      duration_seconds: Math.round(req.duration_ms / 1000),
      instrumental: req.instrumental ?? false,
    }

    return this.submitToQueue(entry.path, body)
  }

  async audioSfx(req: AudioSfxRequest): Promise<AsyncResult> {
    const entry = MODEL_MAP[req.model]
    if (!entry) {
      throw new ApiError('provider_invalid_request', `Unknown fal sfx model: ${req.model}`, 400, null)
    }

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      duration_seconds: req.duration_seconds,
    }

    return this.submitToQueue(entry.path, body)
  }

  /**
   * audioSpeech returns AsyncResult because fal TTS is queue-based.
   * Note: this widens the return type from the Adapter interface default
   * (sync bytes) — types.ts has been updated to allow this.
   */
  async audioSpeech(req: Extract<AudioSpeechRequest, { model: 'elevenlabs-tts-v3' }>): Promise<AsyncResult> {
    const entry = MODEL_MAP[req.model]
    if (!entry) {
      throw new ApiError('provider_invalid_request', `Unknown fal tts model: ${req.model}`, 400, null)
    }

    const body: Record<string, unknown> = {
      text: req.input,
      voice: req.voice,
      // ASSUMPTION: fal elevenlabs TTS accepts 'output_format' similar to ElevenLabs API
      output_format: req.response_format ?? 'mp3',
    }

    return this.submitToQueue(entry.path, body)
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()

    // Decode the encoded task ID: "${modelPath}|${requestId}"
    const pipeIdx = taskId.indexOf('|')
    if (pipeIdx === -1) {
      return {
        status: 'failed',
        error: {
          code: 'provider_invalid_request',
          message: `Invalid fal task ID format (missing | separator): ${taskId}`,
        },
        latency_ms: Date.now() - t0,
      }
    }

    const modelPath = taskId.slice(0, pipeIdx)
    const requestId = taskId.slice(pipeIdx + 1)

    // fal status/result URLs use only the first two path segments (org/model-name),
    // dropping any version-and-mode suffix (e.g. /v3/text-to-video).
    // Wrong: /fal-ai/kling-video/v3/text-to-video/requests/{id}/status
    // Right: /fal-ai/kling-video/requests/{id}/status
    const statusBase = modelPath.split('/').slice(0, 2).join('/')

    // Poll status endpoint
    const statusResp: any = await this.call('GET', `/${statusBase}/requests/${requestId}/status`, null)
    const status: string = statusResp.status

    if (status === 'FAILED') {
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: statusResp.error ?? 'Fal task failed',
          provider_raw: statusResp,
        },
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'IN_QUEUE' || status === 'IN_PROGRESS') {
      return {
        status: 'running',
        latency_ms: Date.now() - t0,
        poll_after_ms: FAL_POLL_AFTER_MS,
      }
    }

    if (status === 'COMPLETED') {
      // Fetch the actual result — same short base path, no version suffix
      const result: any = await this.call('GET', `/${statusBase}/requests/${requestId}`, null)

      // Determine output kind and URL from result shape
      // ASSUMPTION: video models return { video: { url, content_type } }
      //             audio models return { audio: { url, content_type } }
      // Confirm via live smoke.
      const outputs = this.extractOutputs(result)

      return {
        status: 'succeeded',
        outputs,
        latency_ms: Date.now() - t0,
      }
    }

    // Unknown status — treat as still running
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: FAL_POLL_AFTER_MS,
    }
  }

  /**
   * Extract AdapterOutputItems from a fal result payload.
   * Handles video, audio, and image result shapes.
   * ASSUMPTION: Result shapes based on fal docs examples; may need adjustment.
   */
  private extractOutputs(result: any): Array<{ kind: 'video' | 'audio' | 'image'; url?: string; mime_type?: string }> {
    // Video result: { video: { url, content_type } }
    if (result.video?.url) {
      return [{
        kind: 'video',
        url: result.video.url,
        mime_type: result.video.content_type ?? 'video/mp4',
      }]
    }

    // Audio result: { audio: { url, content_type } }
    if (result.audio?.url) {
      return [{
        kind: 'audio',
        url: result.audio.url,
        mime_type: result.audio.content_type ?? 'audio/mpeg',
      }]
    }

    // Alternate audio shape used by some models: { audio_url: { url, content_type } }
    if (result.audio_url?.url) {
      return [{
        kind: 'audio',
        url: result.audio_url.url,
        mime_type: result.audio_url.content_type ?? 'audio/mpeg',
      }]
    }

    // Images result (fallback): { images: [{ url, content_type }] }
    if (Array.isArray(result.images) && result.images.length > 0) {
      return result.images.map((img: any) => ({
        kind: 'image' as const,
        url: img.url,
        mime_type: img.content_type ?? 'image/png',
      }))
    }

    // Could not determine output — return empty; caller should handle gracefully
    return []
  }
}
