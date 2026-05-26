/**
 * Gemini Adapter (Google Generative AI)
 *
 * Supported models:
 *   Chat (sync):  gemini-3-flash, gemini-3.1-pro
 *   Image (sync): nano-banana-pro, nano-banana-2
 *   Video (async):veo-3.1, veo-3.1-lite
 *
 * Auth: x-goog-api-key header
 * Base: https://generativelanguage.googleapis.com/v1beta
 *
 * CONCERNS / ASSUMPTIONS (verified via live smoke in Task 31):
 *   1. Video endpoint uses `:predictLongRunning` suffix (observed from docs).
 *      The docs showed `veo-3.1-generate-preview` as the internal model name
 *      but we pass through the model name as given; live smoke will confirm.
 *   2. nano-banana-pro / nano-banana-2 are passed through as-is to the
 *      generateContent endpoint. Real upstream model names for Imagen-based
 *      models may differ (e.g. imagen-3.0-generate-002). Live smoke needed.
 *   3. Image response shape assumes candidates[0].content.parts[0].inline_data
 *      (same as Gemini 2.5 Flash Image preview response). Confirmed from docs.
 *   4. Veo operation name is used directly as provider_task_id; polling uses
 *      GET /v1beta/{operation.name} which may include the full path segment.
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { ChatCompletionsRequest } from '../schemas/chat-completions.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { newAssetId, signAssetUrl, storeAsset } from '../assets.js'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/**
 * Map our internal model IDs to the upstream Google API model names.
 * Google's Generative Language API returns 404 if the internal names are used directly.
 * Note: nano-banana-2 is aliased to nano-banana-pro-preview because no separate
 * upstream variant is currently known; a live smoke test will reveal if one exists.
 */
const UPSTREAM_MODEL: Record<string, string> = {
  // chat
  'gemini-3-flash':    'gemini-3-flash-preview',
  'gemini-3.1-pro':    'gemini-3.1-pro-preview',
  // image (nano-banana)
  'nano-banana-pro':   'nano-banana-pro-preview',
  'nano-banana-2':     'nano-banana-pro-preview',   // alias: no separate upstream model yet
  // video (veo)
  'veo-3.1':           'veo-3.1-generate-preview',
  'veo-3.1-lite':      'veo-3.1-lite-generate-preview',
}

function toUpstream(model: string): string {
  return UPSTREAM_MODEL[model] ?? model
}

/** How long callers should wait before polling Veo operations (10 seconds) */
const VEO_POLL_AFTER_MS = 10_000

/** Signed URL TTL for generated images (1 hour) */
const IMAGE_URL_TTL_SEC = 3600

export class GeminiAdapter implements Adapter {
  readonly name = 'gemini'
  constructor(private apiKey: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async call(path: string, body: unknown): Promise<unknown> {
    const t0 = Date.now()
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }
    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Gemini ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }
    return parsed
  }

  /** GET a long-running operation status (no body) */
  private async pollOperation(operationName: string): Promise<unknown> {
    const res = await fetch(`${BASE}/${operationName}`, {
      method: 'GET',
      headers: { 'x-goog-api-key': this.apiKey },
    })
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }
    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Gemini poll ${res.status}`,
        toHttpStatus(res.status),
        parsed,
      )
    }
    return parsed
  }

  /** Convert our internal message role to Gemini's role field */
  private toGeminiRole(role: 'user' | 'assistant' | 'system'): string {
    if (role === 'assistant') return 'model'
    // system messages are not directly supported; prepend as user turn
    return 'user'
  }

  /** Build signed asset URL from base64 image data returned by Gemini */
  private async base64ToSignedUrl(base64: string, mimeType: string): Promise<string> {
    const assetId = newAssetId()
    const bytes = Buffer.from(base64, 'base64')
    // Read env at call-time so tests can override via process.env
    const tmpDir = process.env.ASSET_TMP_DIR ?? './tmp'
    const routerPublicUrl = process.env.ROUTER_PUBLIC_URL ?? 'http://localhost:8787'
    const signingSecret = process.env.ASSET_SIGNING_SECRET ?? ''
    await storeAsset(tmpDir, assetId, bytes, mimeType)
    const expires = Math.floor(Date.now() / 1000) + IMAGE_URL_TTL_SEC
    const sig = signAssetUrl(assetId, expires, signingSecret)
    return `${routerPublicUrl}/v1/assets/${assetId}?expires=${expires}&sig=${sig}`
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  async chatCompletion(
    req: Extract<ChatCompletionsRequest, { model: 'gemini-3-flash' | 'gemini-3.1-pro' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()

    // Map messages: filter system messages to user turns (Gemini v1beta does not
    // support a dedicated system role in contents; use systemInstruction for that)
    const systemParts = req.messages
      .filter(m => m.role === 'system')
      .map(m => ({ text: m.content }))

    const contents = req.messages
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: this.toGeminiRole(m.role),
        parts: [{ text: m.content }],
      }))

    const body: Record<string, unknown> = { contents }
    if (systemParts.length > 0) {
      body.systemInstruction = { parts: systemParts }
    }
    if (req.temperature !== undefined) {
      body.generationConfig = { temperature: req.temperature }
    }

    const r: any = await this.call(`/models/${toUpstream(req.model)}:generateContent`, body)
    const text = r.candidates[0].content.parts[0].text as string

    return {
      status: 'succeeded',
      outputs: [{ kind: 'text', text }],
      provider: 'gemini',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'nano-banana-pro' | 'nano-banana-2' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()

    // ASSUMPTION: nano-banana-pro / nano-banana-2 are passed through as model
    // names directly. If the real upstream names differ (e.g. imagen-4.0-*),
    // update the mapping here. Live smoke (Task 31) will confirm.
    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: {
        responseModalities: ['image'],
        // aspect ratio: pass through; not all Imagen endpoints support this field
        ...(req.aspectRatio ? { aspectRatio: req.aspectRatio } : {}),
      },
    }

    const r: any = await this.call(`/models/${toUpstream(req.model)}:generateContent`, body)

    // Gemini image response: candidates[0].content.parts[0].inline_data
    const parts: any[] = r.candidates[0].content.parts
    const outputs = await Promise.all(
      parts
        .filter((p: any) => p.inline_data)
        .map(async (p: any) => {
          const { mime_type, data } = p.inline_data as { mime_type: string; data: string }
          const url = await this.base64ToSignedUrl(data, mime_type)
          return { kind: 'image' as const, url, mime_type }
        }),
    )

    return {
      status: 'succeeded',
      outputs,
      provider: 'gemini',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'veo-3.1' | 'veo-3.1-lite' }>,
  ): Promise<AsyncResult> {
    // ASSUMPTION: Veo uses predictLongRunning suffix (per docs).
    // The operation name returned is used as provider_task_id for polling.
    const body = {
      instances: [{ prompt: req.prompt }],
      parameters: {
        aspectRatio: req.aspectRatio,
      },
    }

    const r: any = await this.call(`/models/${toUpstream(req.model)}:predictLongRunning`, body)

    return {
      status: 'queued',
      provider: 'gemini',
      provider_task_id: r.name as string,
      poll_after_ms: VEO_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.pollOperation(taskId)

    if (r.error) {
      return {
        status: 'failed',
        error: {
          code: 'provider_unavailable',
          message: r.error.message ?? 'Veo operation failed',
          provider_raw: r.error,
        },
        latency_ms: Date.now() - t0,
      }
    }

    if (!r.done) {
      return {
        status: 'running',
        latency_ms: Date.now() - t0,
        poll_after_ms: VEO_POLL_AFTER_MS,
      }
    }

    // Operation complete: extract video URI from response
    // Shape: r.response.generateVideoResponse.generatedSamples[].video.{uri, mimeType}
    const samples: any[] =
      r.response?.generateVideoResponse?.generatedSamples ?? []

    const outputs = samples.map((s: any) => ({
      kind: 'video' as const,
      url: s.video?.uri as string,
      mime_type: (s.video?.mimeType ?? 'video/mp4') as string,
    }))

    return {
      status: 'succeeded',
      outputs,
      latency_ms: Date.now() - t0,
    }
  }
}
