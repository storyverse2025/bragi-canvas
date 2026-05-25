/**
 * xAI Adapter (Grok models)
 *
 * Supported models:
 *   Image (sync):  grok-imagine → upstream "grok-2-image-1212"
 *   Audio TTS:     grok-tts    → upstream "grok-2-tts-1" (returns binary audio bytes)
 *
 * Auth: Authorization: Bearer ${XAI_API_KEY}
 * Base: https://api.x.ai/v1
 *
 * CONCERNS / ASSUMPTIONS (verify during live smoke Task 31):
 *   1. Image upstream model name: "grok-2-image-1212" — best guess based on xAI naming
 *      conventions. Live smoke should confirm the exact model ID accepted by the API.
 *   2. TTS upstream model name: "grok-2-tts-1" — best guess. May be "grok-tts-1" or similar.
 *   3. Image generation request: OpenAI-compatible shape { model, prompt, n }.
 *      xAI may accept additional fields (quality, style, etc.) not yet exposed.
 *   4. TTS voice mapping: uses OpenAI voice names (alloy, echo, etc.). xAI may use
 *      different voice IDs — confirm via live smoke.
 *   5. Image response: OpenAI-compatible { data: [{ url }] }. xAI may also support
 *      b64_json format; we always request URL mode.
 *   6. TTS response: raw binary audio bytes with Content-Type: audio/mpeg.
 *      We read the response as arrayBuffer and convert to Buffer.
 */

import type { Adapter, SyncResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { AudioSpeechRequest } from '../schemas/audio-speech.js'

const BASE = 'https://api.x.ai/v1'

/** Map our image model IDs to xAI upstream model names */
const IMAGE_MODEL_MAP: Record<string, string> = {
  'grok-imagine': 'grok-2-image-1212',
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

    const res = await fetch(`${BASE}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `xAI ${res.status}`,
        res.status === 429 ? 503 : res.status,
        parsed,
      )
    }

    return parsed
  }

  /**
   * Binary POST helper — for TTS which returns raw audio bytes.
   */
  private async callBinary(path: string, body: unknown): Promise<{ bytes: Buffer; mimeType: string }> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      let parsed: any
      try { parsed = JSON.parse(text) } catch { parsed = text }
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `xAI ${res.status}`,
        res.status === 429 ? 503 : res.status,
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

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'grok-imagine' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const upstreamModel = IMAGE_MODEL_MAP[req.model] ?? req.model

    const r: any = await this.callJson('POST', '/images/generations', {
      model: upstreamModel,
      prompt: req.prompt,
      n: 1,
      // ASSUMPTION: xAI accepts response_format; if not, omit this field.
      response_format: 'url',
    })

    return {
      status: 'succeeded',
      outputs: (r.data as Array<{ url: string }>).map(d => ({
        kind: 'image' as const,
        url: d.url,
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
