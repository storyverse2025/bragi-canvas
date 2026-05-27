/**
 * ElevenLabs Adapter (direct API — no fal intermediary)
 *
 * Supported models:
 *   Audio TTS (sync):  elevenlabs-tts-v3 → POST /v1/text-to-speech/{voice_id}
 *   Audio SFX (sync):  elevenlabs-sfx    → POST /v1/sound-generation
 *
 * NOT supported here (paid plan required, 402 on free tier):
 *   elevenlabs-music → POST /v1/music  (remains on fal as fallback)
 *
 * Auth: xi-api-key: ${ELEVENLABS_API_KEY}   (NOT Bearer)
 * Base: https://api.elevenlabs.io
 *
 * Response shape: raw binary audio bytes (mp3). No JSON envelope.
 * Error shape: { detail: { status, message } } or { detail: string }
 *
 * Verified 2026-05-27 from sv-dev (AWS datacenter IP):
 *   - /v1/sound-generation  → 200 with audio/mpeg bytes  (free tier OK)
 *   - /v1/text-to-speech/*  → 200 with premade voices + eleven_v3 / eleven_multilingual_v2
 *                              (free tier OK for premade voices; library voices → 402)
 *   - /v1/music             → 402 paid-plan required
 *
 * Default voice: pNInz6obpgDQGcFmaJgB (Adam — premade, free tier)
 * The plugin's default Rachel (21m00Tcm4TlvDq8ikWAM) requires a paid plan on free-tier keys.
 */

import type { Adapter } from './types.js'
import { ApiError, toHttpStatus } from '../errors.js'
import type { AudioSfxRequest } from '../schemas/audio-sfx.js'
import type { AudioSpeechRequest } from '../schemas/audio-speech.js'

const BASE = 'https://api.elevenlabs.io'

/** Default output format — mp3 44.1kHz 128kbps */
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'

/**
 * Default voice ID for TTS: Adam (premade, available on free tier).
 * Callers may pass any premade voice ID. Library/cloned voices require a paid plan.
 */
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'

export class ElevenLabsAdapter implements Adapter {
  readonly name = 'elevenlabs'

  constructor(private apiKey: string) {}

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * POST to a binary endpoint (all ElevenLabs audio endpoints return raw bytes).
   * On non-2xx responses, parses the JSON error body and throws ApiError.
   */
  private async callBinary(
    path: string,
    body: Record<string, unknown>,
    queryParams?: Record<string, string>,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const url = new URL(`${BASE}${path}`)
    if (queryParams) {
      for (const [k, v] of Object.entries(queryParams)) {
        url.searchParams.set(k, v)
      }
    }

    let res: Response
    try {
      res = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
    } catch (e: any) {
      throw new ApiError(
        'provider_unavailable',
        `elevenlabs network error: ${e?.message ?? e}`,
        503,
        { transport_error: String(e?.message ?? e) },
      )
    }

    if (!res.ok) {
      const text = await res.text()
      let parsed: any
      try { parsed = JSON.parse(text) } catch { parsed = text }
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      // ElevenLabs error shape: { detail: { message } } or { detail: string }
      const detail = parsed?.detail
      const message =
        (typeof detail === 'object' && detail !== null ? detail.message : undefined) ??
        (typeof detail === 'string' ? detail : undefined) ??
        `ElevenLabs ${res.status}`
      throw new ApiError(code, message, toHttpStatus(res.status), parsed)
    }

    const mimeType = res.headers.get('Content-Type') ?? 'audio/mpeg'
    const arrayBuf = await res.arrayBuffer()
    const bytes = Buffer.from(arrayBuf)
    return { bytes, mimeType }
  }

  // ---------------------------------------------------------------------------
  // Adapter interface
  // ---------------------------------------------------------------------------

  /**
   * TTS: POST /v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
   *
   * Returns sync audio bytes. Voice must be a premade ElevenLabs voice ID on free tier.
   * Library (older catalog) voices require a paid plan and return 402.
   *
   * Free-tier confirmed voices: Adam (pNInz6obpgDQGcFmaJgB), Sarah, Roger, George, etc.
   * (all voices listed under /v1/voices with category "premade" work on free tier)
   */
  async audioSpeech(
    req: Extract<AudioSpeechRequest, { model: 'elevenlabs-tts-v3' }>,
  ): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string }> {
    const t0 = Date.now()

    const voiceId = req.voice || DEFAULT_VOICE_ID
    const outputFormat = req.response_format === 'wav' ? 'pcm_44100' : DEFAULT_OUTPUT_FORMAT

    const body: Record<string, unknown> = {
      text: req.input,
      model_id: 'eleven_v3',
      apply_text_normalization: 'auto',
    }

    const { bytes, mimeType } = await this.callBinary(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
      body,
      { output_format: outputFormat },
    )

    return {
      status: 'succeeded',
      bytes,
      mimeType,
      provider: 'elevenlabs',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  /**
   * SFX: POST /v1/sound-generation
   *
   * Returns sync audio bytes. Works on free tier (no restrictions).
   * Duration is capped at 22s by the schema; ElevenLabs accepts 0.5–22s.
   */
  async audioSfx(
    req: Extract<AudioSfxRequest, { model: 'elevenlabs-sfx' }>,
  ): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string }> {
    const t0 = Date.now()

    const body: Record<string, unknown> = {
      text: req.prompt,
      duration_seconds: req.duration_seconds,
    }

    const { bytes, mimeType } = await this.callBinary('/v1/sound-generation', body)

    return {
      status: 'succeeded',
      bytes,
      mimeType,
      provider: 'elevenlabs',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }
}
