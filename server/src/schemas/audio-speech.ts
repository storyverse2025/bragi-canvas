import { z } from 'zod'

export const AudioSpeechBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('grok-tts'),
    input: z.string().min(1).max(4000),
    voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac']).default('mp3'),
    speed: z.number().min(0.25).max(4).default(1),
    // language mirrors plugin src/models/audio.ts grokTTS options. ACCEPTED for
    // parity, but currently a NO-OP: the xai adapter posts to the OpenAI-compat
    // /v1/audio/speech (no language field) and does NOT forward it. Real support
    // needs the native /v1/tts switch — see the note in adapters/xai.ts (follow-up).
    language: z.enum(['auto', 'en', 'zh', 'es', 'de', 'fr', 'ja', 'ko', 'pt-BR']).default('auto'),
  }),
  z.object({
    model: z.literal('elevenlabs-tts-v3'),
    input: z.string().min(1),
    voice: z.string(),
    response_format: z.enum(['mp3', 'wav']).default('mp3'),
    // voice_settings mirrors plugin src/models/audio.ts elevenLabsTTS params:
    //   stability (0-1, def 0.5), similarity_boost (0-1, def 0.75),
    //   style (0-1, def 0), speed (0.7-1.2, def 1).
    // Plugin src/providers/elevenlabs.ts sends these as body.voice_settings object.
    voice_settings: z.object({
      stability: z.number().min(0).max(1).default(0.5),
      similarity_boost: z.number().min(0).max(1).default(0.75),
      style: z.number().min(0).max(1).default(0),
      speed: z.number().min(0.7).max(1.2).default(1),
    }).optional(),
  }),
])

export type AudioSpeechRequest = z.infer<typeof AudioSpeechBody>
