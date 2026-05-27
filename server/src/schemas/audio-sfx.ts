import { z } from 'zod'

export const AudioSfxBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('elevenlabs-sfx'),
    prompt: z.string().min(1),
    duration_seconds: z.number().min(0.5).max(22).default(5),
  }),
])

export type AudioSfxRequest = z.infer<typeof AudioSfxBody>
