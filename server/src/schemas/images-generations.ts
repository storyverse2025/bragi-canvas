import { z } from 'zod'

export const ImagesGenerationsBody = z.discriminatedUnion('model', [
  z.object({
    model: z.literal('gpt-image-2'),
    prompt: z.string().min(1).max(4000),
    n: z.number().int().min(1).max(4).default(1),
    size: z.enum(['1024x1024', '1792x1024', '1024x1792']),
    input_assets: z.array(z.string()).max(1).optional(),
  }),
  z.object({
    model: z.enum(['nano-banana-pro', 'nano-banana-2']),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']),
    input_assets: z.array(z.string()).max(3).optional(),
  }),
  z.object({
    model: z.enum(['seedream-4.5', 'seedream-5.0']),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']),
    n: z.number().int().min(1).max(4).default(1),
  }),
  z.object({
    model: z.literal('grok-imagine'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16']),
  }),
  z.object({
    model: z.enum(['midjourney-v8', 'midjourney-niji-7']),
    prompt: z.string().min(1),
    niji: z.boolean().optional(),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  z.object({
    model: z.literal('luma-uni-1'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '3:2', '2:3']).optional().default('16:9'),
    input_assets: z.array(z.string()).max(1).optional(),
  }),
])

export type ImagesGenerationsRequest = z.infer<typeof ImagesGenerationsBody>
