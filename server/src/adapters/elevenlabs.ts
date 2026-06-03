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
import type { AudioMusicRequest } from '../schemas/audio-music.js'

const BASE = 'https://api.elevenlabs.io'

/** Default output format — mp3 44.1kHz 128kbps */
const DEFAULT_OUTPUT_FORMAT = 'mp3_44100_128'

/**
 * Default voice ID for TTS: Adam (premade, available on free tier).
 * Callers may pass any premade voice ID. Library/cloned voices require a paid plan.
 */
const DEFAULT_VOICE_ID = 'pNInz6obpgDQGcFmaJgB'

/**
 * Map of friendly voice names → ElevenLabs premade voice IDs.
 * Keys are lower-cased for case-insensitive lookup.
 *
 * ElevenLabs premade voices (free-tier accessible):
 *   https://elevenlabs.io/docs/voices/premade-voices
 *
 * OpenAI-style aliases are mapped to phonetically similar premade voices so
 * callers that reuse OpenAI voice names are not broken.
 */
const VOICE_NAME_MAP: Record<string, string> = {
  // ElevenLabs native premade names
  adam:    'pNInz6obpgDQGcFmaJgB',
  rachel:  '21m00Tcm4TlvDq8ikWAM',
  antoni:  'ErXwobaYiN019PkySvjV',
  bella:   'EXAVITQu4vr4xnSDxMaL',
  josh:    'TxGEqnHWrfWFTfGW9XjX',
  arnold:  'VR6AewLTigWG4xSOukaG',
  domi:    'AZnzlk1XvdvUeBnXmlld',
  elli:    'MF3mGyEYCl7XYWbV9V6O',
  // OpenAI-style aliases → closest premade voice
  alloy:   'pNInz6obpgDQGcFmaJgB', // Adam  (neutral male)
  echo:    'ErXwobaYiN019PkySvjV',  // Antoni (male)
  onyx:    'VR6AewLTigWG4xSOukaG',  // Arnold (deep male)
  nova:    'EXAVITQu4vr4xnSDxMaL',  // Bella  (female)
  shimmer: '21m00Tcm4TlvDq8ikWAM',  // Rachel (female)
  fable:   'MF3mGyEYCl7XYWbV9V6O',  // Elli   (female)
}

/**
 * Resolve a caller-supplied voice value to a valid ElevenLabs voice_id.
 *
 * Resolution order:
 *  1. Empty / undefined → DEFAULT_VOICE_ID (Adam)
 *  2. Matches VOICE_NAME_MAP (case-insensitive) → mapped voice_id
 *  3. Looks like a raw ElevenLabs voice_id (10-24 alphanumeric chars) → pass through
 *  4. Unknown → warn and fall back to DEFAULT_VOICE_ID (Adam) rather than erroring
 */
function resolveVoiceId(voice: string | undefined): string {
  if (!voice) return DEFAULT_VOICE_ID

  const lower = voice.toLowerCase()
  const mapped = VOICE_NAME_MAP[lower]
  if (mapped) return mapped

  // Raw voice_id heuristic: ElevenLabs IDs are ~20 alphanumeric chars
  if (/^[A-Za-z0-9]{10,24}$/.test(voice)) return voice

  // Unknown name — fall back gracefully
  console.warn(
    `[elevenlabs] Unknown voice name "${voice}"; falling back to default voice (Adam). ` +
    `Valid friendly names: ${Object.keys(VOICE_NAME_MAP).join(', ')}`,
  )
  return DEFAULT_VOICE_ID
}

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

    const voiceId = resolveVoiceId(req.voice)
    const outputFormat = req.response_format === 'wav' ? 'pcm_44100' : DEFAULT_OUTPUT_FORMAT

    const body: Record<string, unknown> = {
      text: req.input,
      model_id: 'eleven_v3',
      apply_text_normalization: 'auto',
    }

    // Forward voice_settings if provided (stability, similarity_boost, style, speed).
    // Mirrors plugin src/providers/elevenlabs.ts generateTTS which sends these as
    // body.voice_settings when any setting is non-null.
    if (req.voice_settings) {
      body.voice_settings = {
        stability: req.voice_settings.stability,
        similarity_boost: req.voice_settings.similarity_boost,
        style: req.voice_settings.style,
        speed: req.voice_settings.speed,
      }
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
   * Music: POST /v1/music
   *
   * Returns sync audio bytes. Requires a paid ElevenLabs plan (402 on free tier).
   * music_length_ms: desired duration in ms (1000–180000).
   * instrumental: if true, no vocals.
   */
  async audioMusic(
    req: Extract<AudioMusicRequest, { model: 'elevenlabs-music' }>,
  ): Promise<{ status: 'succeeded'; bytes: Buffer; mimeType: string; latency_ms: number; provider: string; model: string }> {
    const t0 = Date.now()

    const body: Record<string, unknown> = {
      prompt: req.prompt,
      music_length_ms: req.duration_ms,
      model_id: 'music_v1',
    }
    if (req.instrumental) {
      body.instrumental = true
    }

    const { bytes, mimeType } = await this.callBinary('/v1/music', body)

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
