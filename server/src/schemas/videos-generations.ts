import { z } from 'zod'

export const VideosGenerationsBody = z.discriminatedUnion('model', [
  z.object({
    model: z.enum(['kling-2.6', 'kling-3.0']),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(2).optional(),
    duration: z.enum(['5', '10']).default('5'),
    aspectRatio: z.enum(['9:16', '16:9', '1:1']),
  }),
  z.object({
    model: z.enum(['seedance-2.0', 'seedance-2.0-fast']),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(1).optional(),
    duration: z.enum(['-1', '5', '10']).default('-1'),
    resolution: z.enum(['480p', '720p', '1080p']).default('1080p'),
    ratio: z.enum(['9:16', '16:9', '1:1']),
    generate_audio: z.boolean().default(true),
  }),
  z.object({
    model: z.literal('grok-video'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).min(1).max(1),
    duration: z.enum(['6']),
  }),
  z.object({
    model: z.enum(['veo-3.1', 'veo-3.1-lite']),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['16:9', '9:16']),
  }),
  z.object({
    model: z.literal('luma-uni-1'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(2).optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
  }),
])
export type VideosGenerationsRequest = z.infer<typeof VideosGenerationsBody>
