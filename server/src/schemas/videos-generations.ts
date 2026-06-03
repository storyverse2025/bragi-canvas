import { z } from 'zod'

export const VideosGenerationsBody = z.discriminatedUnion('model', [
  z.object({
    model: z.enum(['kling-2.6', 'kling-3.0']),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(2).optional(),
    duration: z.enum(['5', '10']).default('5'),
    aspectRatio: z.enum(['9:16', '16:9', '1:1']),
    // mode mirrors plugin KLING_PARAMS: 'std' (Standard) or 'pro' (Pro).
    // Accepted for parity with the plugin UI. NOTE: on the fal path it is a
    // no-op — fal's kling endpoint is hardcoded to the pro variant and the
    // plugin's fal provider does not read `mode` either (it only forwards mode
    // on its tokenrouter path, which the router's kling does not use). See the
    // ASSUMPTION note in adapters/fal.ts. Plugin: src/models/kling.ts KLING_PARAMS.
    mode: z.enum(['std', 'pro']).default('std'),
  }),
  // seedance-2.0 / seedance-2.0-fast: text-to-video (0 assets), image-ref i2v
  // (1 image asset), or video-ref v2v (1 video asset). Mode is inferred from
  // the materialised asset's mimeType in the adapter. Resolution enums differ
  // per model (seedance-2.0 supports 1080p; seedance-2.0-fast does not).
  // resolution is always sent (default '720p') to match plugin behaviour —
  // bragi-canvas-plugin/src/providers/seedance.ts always forwards resolution.
  // Split into two branches for plugin parity.
  z.object({
    model: z.literal('seedance-2.0'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(1).optional(),
    // duration / ratio mirror plugin src/models/seedance.ts:14-48 — '-1' is "auto",
    // otherwise 4–15s; default '5' (plugin default). seedance-2.0 also supports
    // 4:3 / 3:4 (the -fast variant does not).
    duration: z.enum(['-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']).default('5'),
    ratio: z.enum(['9:16', '16:9', '1:1', '4:3', '3:4']),
    generate_audio: z.boolean().default(true),
    resolution: z.enum(['480p', '720p', '1080p']).default('720p'),
  }),
  z.object({
    model: z.literal('seedance-2.0-fast'),
    prompt: z.string().min(1),
    input_assets: z.array(z.string()).max(1).optional(),
    // Mirrors plugin src/models/seedance.ts:83-124 — same duration range, but
    // -fast supports only 3 ratios and no 1080p.
    duration: z.enum(['-1', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']).default('5'),
    ratio: z.enum(['9:16', '16:9', '1:1']),
    generate_audio: z.boolean().default(true),
    resolution: z.enum(['480p', '720p']).default('720p'),
  }),
  // grok-video: text-to-video (0 assets), first-frame i2v (1 image asset),
  // image-ref (1-3 image assets), or video-extend (1 video asset). Mode is
  // inferred from asset count + mimeType when omitted. Enum values AND defaults
  // mirror plugin's bragi-canvas-plugin/src/models/grok.ts:54 modes array and
  // :57-103 param config — the plugin always sends duration/aspect_ratio/
  // resolution (defaults applied via `||` in src/providers/xai.ts), so we
  // default here too for behavioural parity.
  // `mode` is optional; when omitted the adapter infers from asset count/MIME.
  // Plugin modes (grok.ts:54): ['text-to-video','first-frame','image-ref','video-extend']
  z.object({
    model: z.literal('grok-video'),
    prompt: z.string().min(1),
    // image-ref accepts up to 3 assets (plugin xai.ts:187); changed from max(1)
    input_assets: z.array(z.string()).max(3).optional(),
    // Optional explicit mode — omit to use inference (back-compat).
    mode: z.enum(['text-to-video', 'first-frame', 'image-ref', 'video-extend']).optional(),
    duration: z.enum(['5', '10', '15']).default('5'),
    aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']).default('16:9'),
    resolution: z.enum(['480p', '720p', '1080p']).default('720p'),
  }),
  // veo-3.1: text-to-video, first-frame (1 asset), first-last-frame (2 assets),
  // image-ref (1-3 assets). Modes are inferred from input_assets count when
  // `mode` is omitted (back-compat).
  // `mode` is optional — omit to use inference (back-compat).
  // Plugin modes (veo.ts getEffectiveMode): ['text-to-video','first-frame','first-last-frame','image-ref']
  z.object({
    model: z.literal('veo-3.1'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['16:9', '9:16']),
    input_assets: z.array(z.string()).min(1).max(3).optional(),
    // Optional explicit mode — omit to use inference (back-compat).
    mode: z.enum(['text-to-video', 'first-frame', 'first-last-frame', 'image-ref']).optional(),
    durationSeconds: z.number().int().min(2).max(15).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
  }),
  // veo-3.1-lite: only text-to-video or first-frame (1 asset max) per plugin's
  // INPUT_ASSETS_MAX table. image-ref / first-last-frame are not supported.
  // `mode` is optional — omit to use inference (back-compat).
  // Plugin modes for lite (storyverse.ts:97): ['text-to-video','first-frame']
  z.object({
    model: z.literal('veo-3.1-lite'),
    prompt: z.string().min(1),
    aspectRatio: z.enum(['16:9', '9:16']),
    input_assets: z.array(z.string()).min(1).max(1).optional(),
    // Optional explicit mode — omit to use inference (back-compat). Lite only
    // supports text-to-video and first-frame.
    mode: z.enum(['text-to-video', 'first-frame']).optional(),
    durationSeconds: z.number().int().min(2).max(15).optional(),
    resolution: z.enum(['720p', '1080p']).optional(),
  }),
])
export type VideosGenerationsRequest = z.infer<typeof VideosGenerationsBody>
