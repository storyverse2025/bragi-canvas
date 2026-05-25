/**
 * Legnext Adapter (Midjourney proxy)
 *
 * Legnext is a third-party Midjourney API proxy that provides async image generation
 * using Midjourney models.
 *
 * Supported models:
 *   Image (async): midjourney-v8, midjourney-niji-7
 *
 * Auth: Authorization: Bearer ${LEGNEXT_API_KEY}
 * Base: https://api.legnext.com/v1
 *
 * CONCERNS / ASSUMPTIONS (verify with vendor portal during live smoke Task 31):
 *   1. BASE URL: "https://api.legnext.com/v1" — best guess. Alternative possible URL:
 *      "https://api.legneex.com/v1". Confirm correct domain from vendor portal.
 *   2. Auth header: Bearer token assumed. Some proxies use X-API-Key instead.
 *      If Bearer fails, try: X-API-Key: ${LEGNEXT_API_KEY}
 *   3. Submit endpoint: POST /imagine — common convention for MJ proxies. May differ.
 *      Alternative guesses: POST /generate, POST /tasks/imagine, POST /v1/submit
 *   4. Request body shape: { prompt, model, quality } — best guess. "model" field value
 *      mapping (mj-v8, niji-7, etc.) must be confirmed via vendor docs.
 *   5. Response shape from submit: { task_id, status: 'pending' } — common MJ proxy pattern.
 *      Actual fields may differ (e.g., "id" vs "task_id", "state" vs "status").
 *   6. Poll endpoint: GET /tasks/{task_id} — common pattern. May be /status/{task_id}
 *      or /v1/tasks/{task_id}.
 *   7. Poll response: { task_id, status, images?: [{ url }] } — best guess.
 *      Status values may differ (e.g., "complete" vs "succeeded", "processing" vs "in_progress").
 *   8. images array: upstream may return a single string URL instead of an array of objects.
 *   9. Poll interval: 10s initial (MJ typically takes 30-90 seconds).
 *
 * All assumptions above MUST be verified against the Legnext vendor portal / docs before
 * going live. The structural pattern (submit → poll → image URL) is correct.
 */

import type { Adapter, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'

const BASE = 'https://api.legnext.com/v1'

/** How long callers should wait before polling Legnext tasks (10 seconds — MJ is slow) */
const LEGNEXT_POLL_AFTER_MS = 10_000

/**
 * Map our model IDs to Legnext upstream model names.
 * ASSUMPTION: Verify exact model names via vendor portal.
 */
const MODEL_MAP: Record<string, string> = {
  'midjourney-v8':    'mj-v8',
  'midjourney-niji-7': 'niji-7',
}

export class LegnextAdapter implements Adapter {
  readonly name = 'legnext'

  constructor(private apiKey: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
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

    const res = await fetch(`${BASE}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const message =
        parsed?.error ??
        parsed?.message ??
        parsed?.detail ??
        `Legnext ${res.status}`
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

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'midjourney-v8' | 'midjourney-niji-7' }>,
  ): Promise<AsyncResult> {
    const upstreamModel = MODEL_MAP[req.model] ?? req.model

    // ASSUMPTION: Legnext accepts { prompt, model, quality } at POST /imagine
    // Verify exact field names and values via vendor portal.
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      model: upstreamModel,
      quality: req.quality ?? 'medium',
    }

    const r: any = await this.call('POST', '/imagine', body)

    return {
      status: 'queued',
      provider: 'legnext',
      provider_task_id: r.task_id as string,
      poll_after_ms: LEGNEXT_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/tasks/${taskId}`)

    const status: string = r.status

    if (status === 'failed') {
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: r.error ?? r.message ?? 'Legnext task failed',
          provider_raw: r,
        },
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'pending' || status === 'in_progress' || status === 'processing') {
      return {
        status: 'running',
        latency_ms: Date.now() - t0,
        poll_after_ms: LEGNEXT_POLL_AFTER_MS,
      }
    }

    if (status === 'succeeded' || status === 'complete' || status === 'completed') {
      // ASSUMPTION: images returned as array of { url } objects.
      // May also be a single URL string or different field name.
      const images: Array<{ url: string }> = r.images ?? []
      const outputs = images.map(img => ({
        kind: 'image' as const,
        url: img.url,
        mime_type: 'image/png',
      }))

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
      poll_after_ms: LEGNEXT_POLL_AFTER_MS,
    }
  }
}
