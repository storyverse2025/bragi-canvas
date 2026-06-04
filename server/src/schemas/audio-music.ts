import { z } from 'zod'

export const AudioMusicBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('elevenlabs-music'),
    prompt: z.string().min(1),
    duration_ms: z.number().int().min(1000).max(180000).default(30000),
    instrumental: z.boolean().default(false),
  }),
  z.object({
    // minimax-music via fal — async queue (returns AsyncResult, not sync bytes)
    // Mirrors plugin src/models/audio.ts minimaxMusic params exactly.
    // fal upstream: fal-ai/minimax-music/v2.6
    model: z.literal('minimax-music'),
    prompt: z.string().min(1),
    // instrumental options from plugin src/models/audio.ts minimaxMusic (string select)
    instrumental: z.enum(['true', 'false']).default('true'),
  }),
])

export type AudioMusicRequest = z.infer<typeof AudioMusicBody>
