import { z } from 'zod'

export const ImagesGenerationsBody = z.discriminatedUnion('model', [
  // gpt-image-2 via apimart:
  // - imageSize + aspectRatio are resolved to a WxH by the adapter using the
  //   plugin's openai-image-size.ts SIZE_BY_RATIO_AND_TIER table.
  // - The legacy `size` field (OpenAI WxH strings) is kept for back-compat —
  //   if present the adapter passes it directly to apimart as the `size` field
  //   (which apimart also accepts as an aspect-ratio string via SIZE_TO_ASPECT_RATIO).
  //   New callers should prefer imageSize + aspectRatio.
  // - quality is forwarded as-is to apimart.
  z.object({
    model: z.literal('gpt-image-2'),
    prompt: z.string().min(1).max(4000),
    n: z.number().int().min(1).max(4).default(1),
    size: z.enum(['1024x1024', '1792x1024', '1024x1792']).optional(),
    aspectRatio: z.enum(['auto','1:1','3:2','2:3','4:3','3:4','5:4','4:5','16:9','9:16','2:1','1:2','3:1','1:3','21:9','9:21']).optional(),
    imageSize: z.enum(['auto','1K','2K','4K']).default('2K'),
    quality: z.enum(['auto','low','medium','high']).default('auto'),
    input_assets: z.array(z.string()).max(1).optional(),
  }),
  // nano-banana-pro / nano-banana-2 via apimart (Gemini image models):
  // - imageSize is forwarded as `image_size` to apimart (fal field name).
  // - nano-banana-pro: 1K/2K/4K; nano-banana-2: 512/1K/2K/4K (512 is valid for Flash).
  // These are separate branches for per-model imageSize enum differences.
  z.object({
    model: z.literal('nano-banana-pro'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9']),
    imageSize: z.enum(['1K','2K','4K']).default('1K'),
    input_assets: z.array(z.string()).max(3).optional(),
  }),
  // nano-banana-2 supports the plugin's FULL aspect-ratio set incl. the extreme
  // 1:4/4:1/1:8/8:1 panoramas — matches src/models/nano-banana.ts FULL_ASPECT_RATIOS.
  z.object({
    model: z.literal('nano-banana-2'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '4:5', '5:4', '21:9', '1:4', '4:1', '1:8', '8:1']),
    imageSize: z.enum(['512','1K','2K','4K']).default('1K'),
    input_assets: z.array(z.string()).max(3).optional(),
  }),
  // seedream-4.5 via byteplus: resolution 2K/4K.
  // seedream-5.0 via byteplus: resolution 2K/3K (not 4K — mirrors plugin seedream.ts).
  // resolution + aspectRatio are mapped to a WxH `size` via the plugin's SIZE_MAP.
  z.object({
    model: z.literal('seedream-4.5'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']),
    resolution: z.enum(['2K','4K']).default('2K'),
    n: z.number().int().min(1).max(4).default(1),
    input_assets: z.array(z.string()).max(3).optional(),
  }),
  z.object({
    model: z.literal('seedream-5.0'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9']),
    resolution: z.enum(['2K','3K']).default('2K'),
    n: z.number().int().min(1).max(4).default(1),
    input_assets: z.array(z.string()).max(3).optional(),
  }),
  // grok-imagine via xai:
  // - quality selects the upstream tier: 'normal' → grok-imagine-image, else grok-imagine-image-quality.
  // - input_assets present → hits /images/edits (image-ref-to-image mode).
  //   1 ref → body.image={url}; 2+ refs → body.images=[{url}…] (up to 5, mirrors plugin xai.ts:89-95).
  z.object({
    model: z.literal('grok-imagine'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '2:1', '1:2']),
    quality: z.enum(['quality','normal']).default('quality'),
    input_assets: z.array(z.string()).max(5).optional(),
  }),
  z.object({
    model: z.enum(['midjourney-v8', 'midjourney-niji-7']),
    prompt: z.string().min(1),
    niji: z.boolean().optional(),
    quality: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  // luma-uni-1 is type IMAGE (plugin src/models/luma.ts: type 'image').
  // Modes: text-to-image + image-ref-to-image (max 1 asset).
  // Removed from videos-generations.ts.
  z.object({
    model: z.literal('luma-uni-1'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['1:1', '16:9', '9:16', '3:2', '2:3']),
    input_assets: z.array(z.string()).max(1).optional(),
  }),
])

export type ImagesGenerationsRequest = z.infer<typeof ImagesGenerationsBody>
