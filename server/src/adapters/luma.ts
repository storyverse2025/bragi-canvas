/**
 * Luma AI Dream Machine Adapter
 *
 * Supported models:
 *   Video (async): luma-uni-1
 *
 * Auth: Authorization: Bearer ${LUMA_TOKEN}
 * Base: https://api.lumalabs.ai/dream-machine/v1
 *
 * CONCERNS / ASSUMPTIONS (verify during live smoke Task 31):
 *   1. Upstream model name: Luma's API uses model names like "ray-2" or "dream-machine"
 *      internally. The request body may require a specific "model" field or may omit it
 *      entirely (determined by account/tier). Confirm exact field name via live smoke.
 *   2. aspect_ratio values: "16:9", "9:16", "1:1", "4:3", "3:4" — assumed supported.
 *      Live smoke should confirm the exact enum values accepted by Luma.
 *   3. Keyframes: input_assets[0] → keyframes.frame0, input_assets[1] → keyframes.frame1.
 *      Luma docs show { frame0: { type: 'image', url: '...' } } shape.
 *   4. Poll interval: 5s initial. Luma generation typically takes 1-3 minutes.
 *   5. Task completion state: "completed" (Luma uses this vs "succeeded").
 *      taskStatus maps "completed" → "succeeded".
 *   6. Assets URL in response: { assets: { video: 'url' } }
 */

import type { Adapter, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://api.lumalabs.ai/dream-machine/v1'

/** How long callers should wait before polling Luma tasks (5 seconds) */
const LUMA_POLL_AFTER_MS = 5_000

export class LumaAdapter implements Adapter {
  readonly name = 'luma'

  constructor(private token: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
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
      const message =
        parsed?.detail ??
        parsed?.error?.message ??
        parsed?.message ??
        `Luma ${res.status}`
      throw new ApiError(
        code,
        typeof message === 'string' ? message : JSON.stringify(message),
        res.status === 429 ? 503 : res.status,
        parsed,
      )
    }

    return parsed
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'luma-uni-1' }>,
  ): Promise<AsyncResult> {
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
    }

    // Materialize input_assets into keyframes (0, 1, or 2 assets supported)
    // ASSUMPTION: Luma API uses keyframes.frame0 / keyframes.frame1 for start/end images.
    // Confirm field names via live smoke.
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

    const r: any = await this.call('POST', '/generations', body)

    return {
      status: 'queued',
      provider: 'luma',
      provider_task_id: r.id as string,
      poll_after_ms: LUMA_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/generations/${taskId}`)

    const state: string = r.state

    if (state === 'failed') {
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: r.failure_reason ?? r.error ?? 'Luma task failed',
          provider_raw: r,
        },
        latency_ms: Date.now() - t0,
      }
    }

    if (state === 'queued' || state === 'dreaming') {
      return {
        status: 'running',
        latency_ms: Date.now() - t0,
        poll_after_ms: LUMA_POLL_AFTER_MS,
      }
    }

    if (state === 'completed') {
      const videoUrl: string = r.assets?.video
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

    // Unknown state — treat as still running
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: LUMA_POLL_AFTER_MS,
    }
  }
}
