import { z } from 'zod'

export const AudioMusicBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('elevenlabs-music'),
    prompt: z.string().min(1),
    duration_ms: z.number().int().min(1000).max(180000).default(30000),
    instrumental: z.boolean().default(false),
  }),
])

export type AudioMusicRequest = z.infer<typeof AudioMusicBody>
