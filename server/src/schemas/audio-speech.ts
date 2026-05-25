import { z } from 'zod'

export const AudioSpeechBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('grok-tts'),
    input: z.string().min(1).max(4000),
    voice: z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']),
    response_format: z.enum(['mp3', 'opus', 'aac', 'flac']).default('mp3'),
    speed: z.number().min(0.25).max(4).default(1),
  }),
  z.object({
    model: z.literal('elevenlabs-tts-v3'),
    input: z.string().min(1),
    voice: z.string(),
    response_format: z.enum(['mp3', 'wav']).default('mp3'),
  }),
])

export type AudioSpeechRequest = z.infer<typeof AudioSpeechBody>
