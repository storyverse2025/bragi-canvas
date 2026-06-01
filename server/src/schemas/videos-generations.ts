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
    ratio: z.enum(['9:16', '16:9', '1:1']),
    generate_audio: z.boolean().default(true),
  }),
  // grok-video: text-to-video (0 assets), first-frame i2v (1 image asset),
  // or video-extend (1 video asset). Mode is inferred from the asset's
  // mimeType in the adapter. Enum values AND defaults mirror plugin's
  // bragi-canvas-plugin/src/models/grok.ts:57-103 — the plugin always sends
  // duration/aspect_ratio/resolution (defaults applied via `||` in
  // src/providers/xai.ts), so we default here too for behavioural parity.
  z.object({
    model: z.literal('grok-video'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(1).optional(),
    duration: z.enum(['5', '10', '15']).default('5'),
    aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']).default('16:9'),
    resolution: z.enum(['480p', '720p', '1080p']).default('720p'),
  }),
  // veo-3.1: text-to-video, first-frame (1 asset), first-last-frame (2 assets),
  // image-ref (1-3 assets). Modes are inferred from input_assets count by the adapter.
  z.object({
    model: z.literal('veo-3.1'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['16:9', '9:16']),
    input_assets: z.array(z.string()).min(1).max(3).optional(),
    durationSeconds: z.number().int().min(2).max(15).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
  }),
  // veo-3.1-lite: only text-to-video or first-frame (1 asset max) per plugin's
  // INPUT_ASSETS_MAX table.
  z.object({
    model: z.literal('veo-3.1-lite'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['16:9', '9:16']),
    input_assets: z.array(z.string()).min(1).max(1).optional(),
    durationSeconds: z.number().int().min(2).max(15).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
  }),
  z.object({
    model: z.literal('luma-uni-1'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(2).optional(),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4']),
  }),
])
export type VideosGenerationsRequest = z.infer<typeof VideosGenerationsBody>
