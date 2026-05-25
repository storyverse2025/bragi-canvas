/**
 * Byteplus ModelArk Adapter
 *
 * Supported models:
 *   Image (sync):  seedream-4.5, seedream-5.0
 *   Video (async): seedance-2.0, seedance-2.0-fast
 *
 * Auth: Bearer ${apiKey} (ark-... style API key)
 * Base: https://ark.ap-southeast.bytepluses.com/api/v3
 *
 * CONCERNS / ASSUMPTIONS (verified via live smoke in Task 31):
 *   1. Internal model name mapping:
 *      seedream-4.5  → seedream-3-0-t2i-250415 (best guess; actual suffix date may differ)
 *      seedream-5.0  → seedream-5-0-t2i-250512 (best guess; actual date suffix may differ)
 *      seedance-2.0  → seedance-1-0-pro-250528  (best guess; v2.0 internal name unclear)
 *      seedance-2.0-fast → seedance-1-0-lite-250528 (best guess)
 *      Live smoke (Task 31) must confirm these mappings.
 *   2. Image endpoint POST /api/v3/images/generations matches OpenAI-compatible shape
 *      with `data[].url`. Assumed response_format defaults to 'url'.
 *   3. Video task creation: POST /api/v3/contents/generations/tasks
 *      Content array includes text prompt (and optionally image_url for I2V).
 *   4. Task poll: GET /api/v3/contents/generations/tasks/{id}
 *      Success shape: { status: 'succeeded', content: { video_url: '...' } }
 *   5. Base URL region: ap-southeast (Singapore). Other regions may be needed
 *      depending on account geography.
 *   6. aspectRatio is mapped to a `size` equivalent for Seedream; the upstream
 *      may accept `aspect_ratio` directly — live smoke needed.
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://ark.ap-southeast.bytepluses.com/api/v3'

/** How long callers should wait before polling Seedance tasks (5 seconds) */
const SEEDANCE_POLL_AFTER_MS = 5_000

/** Map our model IDs to Byteplus upstream model names */
const MODEL_MAP: Record<string, string> = {
  'seedream-4.5':       'seedream-3-0-t2i-250415',
  'seedream-5.0':       'seedream-5-0-t2i-250512',
  'seedance-2.0':       'seedance-1-0-pro-250528',
  'seedance-2.0-fast':  'seedance-1-0-lite-250528',
}

/** Map aspect ratio strings to pixel size strings for Seedream */
const ASPECT_RATIO_TO_SIZE: Record<string, string> = {
  '1:1':   '1024x1024',
  '16:9':  '1280x720',
  '9:16':  '720x1280',
  '4:3':   '1024x768',
  '3:4':   '768x1024',
}

export class ByteplusAdapter implements Adapter {
  readonly name = 'byteplus'

  constructor(private config: {
    apiKey: string
    accessKey: string
    secretKey: string
    project: string
  }) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

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

    const res = await fetch(`${BASE}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Byteplus ${res.status}`,
        res.status === 429 ? 503 : res.status,
        parsed,
      )
    }

    return parsed
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'seedream-4.5' | 'seedream-5.0' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()

    const upstreamModel = MODEL_MAP[req.model] ?? req.model
    const size = ASPECT_RATIO_TO_SIZE[req.aspectRatio] ?? '1024x1024'

    const body: Record<string, unknown> = {
      model: upstreamModel,
      prompt: req.prompt,
      n: req.n ?? 1,
      size,
      response_format: 'url',
    }

    const r: any = await this.call('POST', '/images/generations', body)

    const outputs = (r.data as Array<{ url?: string; b64_json?: string }>).map(d => ({
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

    // Build content array: always include text prompt
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: req.prompt },
    ]

    // If input_assets provided, materialize the first one as image_url
    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      content.push({
        type: 'image_url',
        image_url: { url: m.url },
      })
    }

    const body: Record<string, unknown> = {
      model: upstreamModel,
      content,
    }

    // Pass optional video parameters if provided
    // ASSUMPTION: Byteplus accepts these as top-level request params
    if (req.duration && req.duration !== '-1') {
      body.duration = Number(req.duration)
    }
    if (req.resolution) {
      body.resolution = req.resolution
    }
    if (req.ratio) {
      body.aspect_ratio = req.ratio
    }
    if (req.generate_audio !== undefined) {
      body.generate_audio = req.generate_audio
    }

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

    if (status === 'failed') {
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: r.error?.message ?? 'Seedance task failed',
          provider_raw: r.error,
        },
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'queued' || status === 'running') {
      return {
        status: 'running',
        latency_ms: Date.now() - t0,
        poll_after_ms: SEEDANCE_POLL_AFTER_MS,
      }
    }

    if (status === 'succeeded') {
      const videoUrl: string = r.content?.video_url
      return {
        status: 'succeeded',
        outputs: [
          {
            kind: 'video',
            url: videoUrl,
            mime_type: 'video/mp4',
          },
        ],
        latency_ms: Date.now() - t0,
      }
    }

    // Unknown status — treat as still running
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: SEEDANCE_POLL_AFTER_MS,
    }
  }
}
