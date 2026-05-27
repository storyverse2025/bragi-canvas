# V1 Router Adapter Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite all adapters in the Bragi Router V1 server to match the production Python code in the Storyverse monorepo, add apimart adapter, extend tokenrouter, update registry, sync env vars, redeploy to sv-dev, and re-smoke.

**Architecture:** Each adapter is a TypeScript class implementing `Adapter` (from `src/adapters/types.ts`). The registry maps model IDs to providers. The adapter factory (`src/adapters/index.ts`) instantiates adapters from env keys. All changes are atomic commits per adapter.

**Tech Stack:** TypeScript, Hono, Vitest, nock, pnpm, node-fetch, zod

---

## File Map

**Modified files:**
- `server/src/adapters/byteplus.ts` — rewrite: Beijing base URL, doubao model names, size calc helper, correct content body for Seedance
- `server/src/adapters/fal.ts` — update MODEL_MAP: kling o3/pro path, grok-video path, add nano-banana image generation
- `server/src/adapters/luma.ts` — rewrite: proxy base URL/token from env, T2I + I2I endpoints, keep video as-is
- `server/src/adapters/xai.ts` — image model → `grok-imagine-image-quality`, add aspect_ratio + resolution fields
- `server/src/adapters/tokenrouter.ts` — add MODEL_MAP entries for gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro
- `server/src/adapters/legnext.ts` — imageGeneration throws ApiError 'unknown_model' for midjourney
- `server/src/adapters/index.ts` — add apimart case
- `server/src/registry.ts` — re-route 6 models, add 'apimart' to Provider type
- `server/src/env.ts` — add APIMART_API_KEY, LUMA_PROXY_BEARER_TOKEN, LUMA_PROXY_BASE_URL
- `server/.env.example` — add new vars
- `server/.env` — append LUMA secrets + APIMART_API_KEY from monorepo

**New files:**
- `server/src/adapters/apimart.ts` — new adapter for gpt-image-2 via apimart async API
- `server/test/adapters/apimart.test.ts` — unit tests
- `server/test/fixtures/apimart/submit-success.json`
- `server/test/fixtures/apimart/task-completed.json`
- `server/test/fixtures/apimart/error-400.json`

**Modified test files:**
- `server/test/adapters/byteplus.test.ts` — update BASE URL, add size calc test
- `server/test/adapters/fal.test.ts` — update kling path constant, add nano-banana test
- `server/test/adapters/luma.test.ts` — update BASE to proxy URL, update token constructor
- `server/test/adapters/xai.test.ts` — no functional change needed (test still passes)
- `server/test/adapters/tokenrouter.test.ts` — add tests for gpt-5.4-pro, gemini-3.1-pro
- `server/test/adapters/index.test.ts` — add apimart provider test
- `server/test/registry.test.ts` — update gpt-image-2 → apimart, add new entries

---

## Task 1: Rewrite `byteplus.ts` — Beijing base URL + doubao model names + correct body

**Files:**
- Modify: `server/src/adapters/byteplus.ts`
- Modify: `server/test/adapters/byteplus.test.ts`

Reference truth:
- `volcengine_images.py`: `ARK_API_BASE = "https://ark.cn-beijing.volces.com/api/v3"`, size calc function
- `volcengine.py`: `SEEDANCE_MODEL = "doubao-seedance-2-0-260128"`, content body shape with `ratio` + `duration` + `generate_audio`

Key facts from Python reference:
- Image endpoint: `POST /images/generations` (synchronous)
- Image body: `{ model, prompt, response_format: "url", stream: false, watermark: false, size: "<WxH>", image?: "<url>" }`
- Size calc: `aspect_ratio_to_seedream_size()` — 3,686,400 min pixels, ceil to 64px, max 4096
- Video endpoint: `POST /contents/generations/tasks`
- Video body: `{ model, content: [{type:"text",text}, {type:"image_url",image_url:{url},role:"reference_image"}], ratio: aspect_ratio, duration: int, generate_audio: bool }`
- Poll: `GET /contents/generations/tasks/{id}`
- Poll status: `queued` → running, `preparing` → running, `running` → running, `succeeded` → succeeded, else → failed
- Model names: `doubao-seedream-4-5-251128`, `doubao-seedream-5-0-260128`, `doubao-seedance-2-0-260128`, `doubao-seedance-2-0-fast-260128` (guessed)
- Error codes: 11 VOLCENGINE_ERROR_CODES map to provider_rejected/provider_unavailable/quota_exceeded

- [ ] **Step 1: Update byteplus test BASE URL and test for new model names**

```typescript
// server/test/adapters/byteplus.test.ts
// Change BASE to Beijing URL
const BASE = 'https://ark.cn-beijing.volces.com'
// The rest of the tests remain structurally the same — fixture URLs don't matter
// Add one test for aspectRatioToSeeadreamSize helper
```

Full updated test file:
```typescript
import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import imgFx from '../fixtures/byteplus/image-success.json' with { type: 'json' }
import videoCreatedFx from '../fixtures/byteplus/video-task-created.json' with { type: 'json' }
import videoSucceededFx from '../fixtures/byteplus/video-task-succeeded.json' with { type: 'json' }
import errorFx from '../fixtures/byteplus/error-400.json' with { type: 'json' }
import { ByteplusAdapter, aspectRatioToSeeadreamSize } from '../../src/adapters/byteplus.js'

const BASE = 'https://ark.cn-beijing.volces.com'

const config = {
  apiKey: 'ark-test-key',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
  project: 'test-project',
}

afterEach(() => {
  nock.cleanAll()
})

describe('aspectRatioToSeeadreamSize', () => {
  it('1:1 produces square at or above 3686400 pixels, multiple of 64', () => {
    const size = aspectRatioToSeeadreamSize('1:1')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBe(h)
    expect(w * h).toBeGreaterThanOrEqual(3_686_400)
    expect(w % 64).toBe(0)
    expect(h % 64).toBe(0)
  })

  it('16:9 produces landscape at or above 3686400 pixels', () => {
    const size = aspectRatioToSeeadreamSize('16:9')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBeGreaterThan(h)
    expect(w * h).toBeGreaterThanOrEqual(3_686_400)
  })

  it('9:16 produces portrait', () => {
    const size = aspectRatioToSeeadreamSize('9:16')
    const [w, h] = size.split('x').map(Number)
    expect(h).toBeGreaterThan(w)
  })

  it('invalid ratio falls back to 16:9 shape', () => {
    const size = aspectRatioToSeeadreamSize('bad:ratio')
    const [w, h] = size.split('x').map(Number)
    expect(w).toBeGreaterThan(h)
  })
})

describe('ByteplusAdapter', () => {
  it('imageGeneration happy path (seedream-4.5) returns outputs[0].url', async () => {
    nock(BASE)
      .post('/api/v3/images/generations')
      .reply(200, imgFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.imageGeneration!({
      model: 'seedream-4.5',
      prompt: 'a beautiful sunset',
      aspectRatio: '1:1',
      n: 1,
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toContain('seedream-result-abc123.png')
    expect(result.provider).toBe('byteplus')
    expect(result.model).toBe('seedream-4.5')
  })

  it('videoGeneration happy path (seedance-2.0) returns AsyncResult with provider_task_id', async () => {
    nock(BASE)
      .post('/api/v3/contents/generations/tasks')
      .reply(200, videoCreatedFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.videoGeneration!({
      model: 'seedance-2.0',
      prompt: 'a drone flying over a city',
      ratio: '16:9',
      duration: '5',
      resolution: '1080p',
      generate_audio: true,
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('byteplus')
    expect(result.provider_task_id).toBe('task-seedance-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus for completed task returns succeeded with video output', async () => {
    nock(BASE)
      .get('/api/v3/contents/generations/tasks/task-seedance-abc123')
      .reply(200, videoSucceededFx)

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.taskStatus!('task-seedance-abc123')

    expect(result.status).toBe('succeeded')
    expect(result.outputs!).toHaveLength(1)
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('seedance-result-abc123.mp4')
  })

  it('taskStatus maps sensitive content error code to provider_rejected', async () => {
    nock(BASE)
      .get('/api/v3/contents/generations/tasks/task-fail-123')
      .reply(200, {
        id: 'task-fail-123',
        status: 'failed',
        error: { code: 'SensitiveContentDetected', message: 'content policy' },
      })

    const adapter = new ByteplusAdapter(config)
    const result = await adapter.taskStatus!('task-fail-123')

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('provider_rejected')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/api/v3/images/generations')
      .reply(400, errorFx)

    const adapter = new ByteplusAdapter(config)
    await expect(
      adapter.imageGeneration!({
        model: 'seedream-4.5',
        prompt: 'bad request',
        aspectRatio: '1:1',
        n: 1,
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
```

- [ ] **Step 2: Run test to confirm it fails (old BASE URL / missing export)**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/byteplus.test.ts`
Expected: FAIL — BASE URL mismatch, no `aspectRatioToSeeadreamSize` export, `provider_rejected` not implemented

- [ ] **Step 3: Rewrite `byteplus.ts`**

```typescript
// server/src/adapters/byteplus.ts
/**
 * Byteplus ModelArk Adapter — Volcengine Beijing region
 *
 * Supported models:
 *   Image (sync):  seedream-4.5, seedream-5.0
 *   Video (async): seedance-2.0, seedance-2.0-fast
 *
 * Auth: Bearer ${BYTEPLUS_API_KEY}  (ark-... token)
 * Base: https://ark.cn-beijing.volces.com/api/v3
 *
 * Ground truth: apps/backend/app/core/volcengine_images.py (Seedream)
 *               apps/backend/app/workers/providers/volcengine.py (Seedance)
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const BASE = 'https://ark.cn-beijing.volces.com/api/v3'

const SEEDANCE_POLL_AFTER_MS = 5_000
const MIN_SEEDREAM_PIXELS = 3_686_400

/** Map our model IDs to Volcengine doubao upstream model names */
const MODEL_MAP: Record<string, string> = {
  'seedream-4.5':       'doubao-seedream-4-5-251128',
  'seedream-5.0':       'doubao-seedream-5-0-260128',
  'seedance-2.0':       'doubao-seedance-2-0-260128',
  'seedance-2.0-fast':  'doubao-seedance-2-0-fast-260128',
}

/**
 * Volcengine Ark error codes → our error types.
 * Source: apps/backend/app/workers/providers/volcengine.py VOLCENGINE_ERROR_CODES
 */
const VOLCENGINE_ERROR_CODES: Record<string, { message: string; kind: 'rejected' | 'unavailable' | 'quota' }> = {
  'SensitiveContentDetected':                                { message: 'Sensitive content detected', kind: 'rejected' },
  'InputTextSensitiveContentDetected':                       { message: 'Input text contains sensitive content', kind: 'rejected' },
  'InputImageSensitiveContentDetected':                      { message: 'Input image contains sensitive content', kind: 'rejected' },
  'InputVideoSensitiveContentDetected':                      { message: 'Input video contains sensitive content', kind: 'rejected' },
  'OutputVideoSensitiveContentDetected':                     { message: 'Output video contains sensitive content', kind: 'rejected' },
  'OutputAudioSensitiveContentDetected':                     { message: 'Output audio contains sensitive content', kind: 'rejected' },
  'OutputVideoSensitiveContentDetected.PolicyViolation':     { message: 'Output video copyright restriction', kind: 'rejected' },
  'InputImageSensitiveContentDetected.PrivacyInformation':   { message: 'Input image may contain real person', kind: 'rejected' },
  'QuotaExceeded':         { message: 'Quota exhausted', kind: 'quota' },
  'ServerOverloaded':      { message: 'Server overloaded', kind: 'unavailable' },
  'InternalServiceError':  { message: 'Internal service error', kind: 'unavailable' },
}

/**
 * Translate our canonical aspect ratio string into an explicit WxH size.
 * Seedream 5.0 enforces a 3,686,400-pixel minimum.
 * Logic mirrors volcengine_images.py aspect_ratio_to_seedream_size().
 */
export function aspectRatioToSeeadreamSize(aspectRatio: string): string {
  let widthRatio = 16
  let heightRatio = 9
  try {
    const parts = aspectRatio.split(':')
    if (parts.length === 2) {
      const w = parseInt(parts[0], 10)
      const h = parseInt(parts[1], 10)
      if (w > 0 && h > 0) { widthRatio = w; heightRatio = h }
    }
  } catch { /* use defaults */ }

  const longR = Math.max(widthRatio, heightRatio)
  const shortR = Math.min(widthRatio, heightRatio)

  const minLong = Math.sqrt(MIN_SEEDREAM_PIXELS * longR / shortR)
  let longSide = Math.max(2560, Math.ceil(minLong / 64) * 64)
  let shortSide = Math.max(512, Math.ceil(longSide * shortR / longR / 64) * 64)

  longSide = Math.min(longSide, 4096)
  shortSide = Math.min(shortSide, 4096)

  if (widthRatio >= heightRatio) {
    return `${longSide}x${shortSide}`
  }
  return `${shortSide}x${longSide}`
}

export class ByteplusAdapter implements Adapter {
  readonly name = 'byteplus'

  constructor(private config: {
    apiKey: string
    accessKey: string
    secretKey: string
    project: string
  }) {}

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    const res = await fetch(`${BASE}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      throw new ApiError(
        code,
        parsed?.error?.message ?? `Byteplus ${res.status}`,
        res.status === 429 ? 503 : res.status,
        parsed,
      )
    }

    return parsed
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'seedream-4.5' | 'seedream-5.0' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const upstreamModel = MODEL_MAP[req.model] ?? req.model
    const size = aspectRatioToSeeadreamSize(req.aspectRatio ?? '16:9')

    const body: Record<string, unknown> = {
      model: upstreamModel,
      prompt: req.prompt,
      response_format: 'url',
      stream: false,
      watermark: false,
      size,
    }

    // I2I: pass first input_asset URL as image field
    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      body.image = m.url
    }

    const r: any = await this.call('POST', '/images/generations', body)

    const outputs = (r.data as Array<{ url?: string }>).map(d => ({
      kind: 'image' as const,
      url: d.url,
      mime_type: 'image/jpeg',
    }))

    return {
      status: 'succeeded',
      outputs,
      provider: 'byteplus',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'seedance-2.0' | 'seedance-2.0-fast' }>,
  ): Promise<AsyncResult> {
    const upstreamModel = MODEL_MAP[req.model] ?? req.model

    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: req.prompt },
    ]

    if (req.input_assets && req.input_assets.length > 0) {
      const m = await materializeAsset(req.input_assets[0], 'url')
      content.push({
        type: 'image_url',
        image_url: { url: m.url },
        role: 'reference_image',
      })
    }

    const body: Record<string, unknown> = {
      model: upstreamModel,
      content,
      ratio: req.ratio ?? '16:9',
      duration: req.duration ? Number(req.duration) : -1,
      generate_audio: req.generate_audio ?? true,
    }

    const r: any = await this.call('POST', '/contents/generations/tasks', body)

    return {
      status: 'queued',
      provider: 'byteplus',
      provider_task_id: r.id as string,
      poll_after_ms: SEEDANCE_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/contents/generations/tasks/${taskId}`)

    const status: string = r.status

    if (status === 'succeeded') {
      const videoUrl: string = r.content?.video_url
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: videoUrl, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'queued' || status === 'preparing' || status === 'running') {
      return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: SEEDANCE_POLL_AFTER_MS }
    }

    // failed or unknown — check error codes
    const errorObj = r.error ?? {}
    const vcCode: string = errorObj.code ?? ''
    const vcMsg: string = errorObj.message ?? `Seedance task ${status}`

    const entry = VOLCENGINE_ERROR_CODES[vcCode]
    if (entry) {
      const code = entry.kind === 'rejected' ? 'provider_rejected'
        : entry.kind === 'quota' ? 'quota_exceeded'
        : 'provider_unavailable'
      return {
        status: 'failed',
        error: { code, message: entry.message, provider_raw: r.error },
        latency_ms: Date.now() - t0,
      }
    }

    return {
      status: 'failed',
      error: {
        code: 'provider_unavailable',
        message: vcCode ? `[${vcCode}] ${vcMsg}` : vcMsg,
        provider_raw: r.error,
      },
      latency_ms: Date.now() - t0,
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/byteplus.test.ts`
Expected: 8 tests pass (4 original + 4 new)

- [ ] **Step 5: Run full suite to check for regressions**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/byteplus.ts server/test/adapters/byteplus.test.ts
git commit -m "feat(server): byteplus adapter — switch to Volcengine 北京区 + doubao model names

- Base URL: ark.cn-beijing.volces.com (was bytepluses.com Singapore)
- Model names: doubao-seedream-4-5-251128, doubao-seedream-5-0-260128,
  doubao-seedance-2-0-260128, doubao-seedance-2-0-fast-260128
- Size calc: aspectRatioToSeeadreamSize() mirrors Python volcengine_images.py
- Video body: { content, ratio, duration, generate_audio } per volcengine.py
- Error codes: 11 VOLCENGINE_ERROR_CODES mapped to provider_rejected/unavailable/quota
- Status mapping: queued/preparing/running → running, succeeded → succeeded

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Update `fal.ts` — correct kling/grok-video paths + add nano-banana image support

**Files:**
- Modify: `server/src/adapters/fal.ts`
- Modify: `server/test/adapters/fal.test.ts`
- Create: `server/test/fixtures/fal/nano-banana-submit.json`

Key facts from Python reference (`_fal.py`):
- Kling 2.6 and 3.0 both use: `fal-ai/kling-video/o3/pro/reference-to-video` (same path)
- Grok-video: `xai/grok-imagine-video/image-to-video`
- nano-banana-pro T2I: `fal-ai/nano-banana-pro`
- nano-banana-pro I2I: `fal-ai/nano-banana-pro/edit`
- nano-banana-2 T2I: `fal-ai/nano-banana-2`
- nano-banana-2 I2I: `fal-ai/nano-banana-2/edit`
- Kling body fields: `{ prompt, duration (int), aspect_ratio, generate_audio, image_urls? }`
  (duration is int, NOT string — kling o3/pro uses int duration 3-15)
- Grok-video body: `{ prompt, image_url, resolution: "720p", aspect_ratio, duration (int) }`
- nano-banana body: `{ prompt, num_images: 1, aspect_ratio, output_format: "png" }` (T2I)
  I2I adds: `image_urls: [...]`
- fal status base path stripping: keep first 4 segments for kling o3/pro
  (`fal-ai/kling-video/o3/pro`) not just 2 — BUT the current code strips to 2 segments
  and the actual fal queue API uses the root model path (org/model). Verify:
  `fal-ai/kling-video/o3/pro/reference-to-video` → status base is `fal-ai/kling-video`
  (same 2-segment rule applies — fal queue status uses `fal-ai/kling-video`)

- [ ] **Step 1: Create nano-banana fixture**

Create `server/test/fixtures/fal/nano-banana-submit.json`:
```json
{
  "request_id": "nano-banana-req-abc123",
  "status": "IN_QUEUE",
  "response_url": "https://queue.fal.run/fal-ai/nano-banana-2/requests/nano-banana-req-abc123",
  "status_url": "https://queue.fal.run/fal-ai/nano-banana-2/requests/nano-banana-req-abc123/status",
  "cancel_url": "https://queue.fal.run/fal-ai/nano-banana-2/requests/nano-banana-req-abc123/cancel"
}
```

- [ ] **Step 2: Update fal test with new path constants and nano-banana test**

Full updated `server/test/adapters/fal.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import videoSubmitFx from '../fixtures/fal/video-submit.json' with { type: 'json' }
import grokVideoSubmitFx from '../fixtures/fal/grok-video-submit.json' with { type: 'json' }
import audioMusicSubmitFx from '../fixtures/fal/audio-music-submit.json' with { type: 'json' }
import nanoBananaSubmitFx from '../fixtures/fal/nano-banana-submit.json' with { type: 'json' }
import taskInQueueFx from '../fixtures/fal/task-status-in-queue.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/fal/task-status-completed.json' with { type: 'json' }
import videoResultFx from '../fixtures/fal/video-result.json' with { type: 'json' }
import { FalAdapter } from '../../src/adapters/fal.js'

const BASE = 'https://queue.fal.run'
// kling 2.6 and 3.0 both use o3/pro/reference-to-video
const KLING_O3_PATH = '/fal-ai/kling-video/o3/pro/reference-to-video'
const GROK_VIDEO_PATH = '/xai/grok-imagine-video/image-to-video'
const MUSIC_PATH = '/fal-ai/elevenlabs/music'
const NANO_BANANA_2_PATH = '/fal-ai/nano-banana-2'

afterEach(() => {
  nock.cleanAll()
})

describe('FalAdapter', () => {
  it('videoGeneration kling-3.0 uses o3/pro/reference-to-video path', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-3.0',
      prompt: 'a cinematic sunset over the ocean',
      duration: '5',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain('|')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('videoGeneration kling-2.6 also uses o3/pro/reference-to-video path', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(200, videoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'kling-2.6',
      prompt: 'a cinematic sunset',
      duration: '5',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(videoSubmitFx.request_id)
  })

  it('videoGeneration grok-video uses xai/grok-imagine-video/image-to-video path', async () => {
    nock(BASE)
      .post(GROK_VIDEO_PATH)
      .reply(200, grokVideoSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.videoGeneration!({
      model: 'grok-video',
      prompt: 'a futuristic city with flying cars',
      duration: '6',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(grokVideoSubmitFx.request_id)
  })

  it('audioMusic elevenlabs-music returns AsyncResult', async () => {
    nock(BASE)
      .post(MUSIC_PATH)
      .reply(200, audioMusicSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.audioMusic!({
      model: 'elevenlabs-music',
      prompt: 'an uplifting orchestral piece',
      duration_ms: 30000,
      instrumental: true,
    })

    expect(result.status).toBe('queued')
    expect(result.provider_task_id).toContain(audioMusicSubmitFx.request_id)
  })

  it('imageGeneration nano-banana-2 T2I returns AsyncResult', async () => {
    nock(BASE)
      .post(NANO_BANANA_2_PATH)
      .reply(200, nanoBananaSubmitFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.imageGeneration!({
      model: 'nano-banana-2',
      prompt: 'a beautiful sunset',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('fal')
    expect(result.provider_task_id).toContain(nanoBananaSubmitFx.request_id)
  })

  it('taskStatus returns running for IN_QUEUE status', async () => {
    const modelPath = 'fal-ai/kling-video/o3/pro/reference-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`
    const statusBase = 'fal-ai/kling-video'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskInQueueFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with video output when COMPLETED', async () => {
    const modelPath = 'fal-ai/kling-video/o3/pro/reference-to-video'
    const requestId = '764cabcf-b745-4b3e-ae38-1200304cf45b'
    const taskId = `${modelPath}|${requestId}`
    const statusBase = 'fal-ai/kling-video'

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}/status`)
      .reply(200, taskCompletedFx)

    nock(BASE)
      .get(`/${statusBase}/requests/${requestId}`)
      .reply(200, videoResultFx)

    const adapter = new FalAdapter('fal-test-key')
    const result = await adapter.taskStatus!(taskId)

    expect(result.status).toBe('succeeded')
    expect(result.outputs![0].kind).toBe('video')
    expect(result.outputs![0].url).toContain('kling-result-abc123.mp4')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post(KLING_O3_PATH)
      .reply(400, { detail: 'Invalid request: prompt is too long' })

    const adapter = new FalAdapter('fal-test-key')
    await expect(
      adapter.videoGeneration!({
        model: 'kling-3.0',
        prompt: 'bad request',
        duration: '5',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
```

- [ ] **Step 3: Run test to confirm failures (wrong paths)**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/fal.test.ts`
Expected: FAIL — kling path mismatch, grok path mismatch, no imageGeneration method

- [ ] **Step 4: Update `fal.ts` MODEL_MAP and add imageGeneration**

Replace the MODEL_MAP and add imageGeneration method. Key changes:
1. `kling-2.6` and `kling-3.0` → `fal-ai/kling-video/o3/pro/reference-to-video`
2. `grok-video` → `xai/grok-imagine-video/image-to-video`
3. Add `nano-banana-pro`, `nano-banana-2` image entries
4. Add `imageGeneration()` method using submitToQueue
5. Kling body: duration must be int, not string (parse it)

Updated MODEL_MAP in `fal.ts`:
```typescript
const MODEL_MAP: Record<string, ModelEntry> = {
  'kling-2.6': {
    path: 'fal-ai/kling-video/o3/pro/reference-to-video',
    t2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
    i2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
  },
  'kling-3.0': {
    path: 'fal-ai/kling-video/o3/pro/reference-to-video',
    t2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
    i2vPath: 'fal-ai/kling-video/o3/pro/reference-to-video',
  },
  'grok-video': {
    path: 'xai/grok-imagine-video/image-to-video',
    t2vPath: 'xai/grok-imagine-video/image-to-video',
    i2vPath: 'xai/grok-imagine-video/image-to-video',
  },
  'elevenlabs-music': { path: 'fal-ai/elevenlabs/music' },
  'elevenlabs-sfx':   { path: 'fal-ai/elevenlabs/sound-effects' },
  'elevenlabs-tts-v3':{ path: 'fal-ai/elevenlabs/tts/v3' },
  // Image models
  'nano-banana-pro': {
    path: 'fal-ai/nano-banana-pro',
    t2vPath: 'fal-ai/nano-banana-pro',
    i2vPath: 'fal-ai/nano-banana-pro/edit',
  },
  'nano-banana-2': {
    path: 'fal-ai/nano-banana-2',
    t2vPath: 'fal-ai/nano-banana-2',
    i2vPath: 'fal-ai/nano-banana-2/edit',
  },
}
```

Add imageGeneration method (add to FalAdapter class):
```typescript
async imageGeneration(
  req: Extract<ImagesGenerationsRequest, { model: 'nano-banana-pro' | 'nano-banana-2' }>,
): Promise<AsyncResult> {
  const entry = MODEL_MAP[req.model]
  if (!entry) {
    throw new ApiError('provider_invalid_request', `Unknown fal image model: ${req.model}`, 400, null)
  }

  const hasAssets = req.input_assets && req.input_assets.length > 0
  const modelPath = hasAssets ? (entry.i2vPath ?? entry.path) : (entry.t2vPath ?? entry.path)

  const body: Record<string, unknown> = {
    prompt: req.prompt,
    num_images: 1,
    aspect_ratio: req.aspectRatio ?? '16:9',
    output_format: 'png',
  }

  if (hasAssets) {
    const urls: string[] = []
    for (const asset of req.input_assets!) {
      const m = await materializeAsset(asset, 'url')
      if (m.url) urls.push(m.url)
    }
    body.image_urls = urls
  }

  return this.submitToQueue(modelPath, body)
}
```

Also add `ImagesGenerationsRequest` import and `materializeAsset` import to `fal.ts`.

Also fix kling body — duration should be int:
```typescript
if ('duration' in req && req.duration) {
  body.duration = Number(req.duration)  // already int
}
```

And grok-video body needs `image_url` (singular) not `image_urls`, plus `resolution`:
```typescript
// For grok-video with assets:
if (hasAssets && req.model === 'grok-video') {
  const m = await materializeAsset(req.input_assets![0], 'url')
  body.image_url = m.url
  body.resolution = '720p'
} else if (hasAssets) {
  // kling: image_urls array
  const urls: string[] = []
  for (const asset of req.input_assets!) {
    const m = await materializeAsset(asset, 'url')
    if (m.url) urls.push(m.url)
  }
  body.image_urls = urls
}
```

Full rewritten `videoGeneration` method:
```typescript
async videoGeneration(
  req: Extract<VideosGenerationsRequest, { model: 'kling-2.6' | 'kling-3.0' | 'grok-video' }>,
): Promise<AsyncResult> {
  const entry = MODEL_MAP[req.model]
  if (!entry) {
    throw new ApiError('provider_invalid_request', `Unknown fal video model: ${req.model}`, 400, null)
  }

  const hasAssets = req.input_assets && req.input_assets.length > 0
  const modelPath = hasAssets ? (entry.i2vPath ?? entry.path) : (entry.t2vPath ?? entry.path)

  const body: Record<string, unknown> = {
    prompt: req.prompt,
  }

  if ('duration' in req && req.duration) {
    body.duration = Number(req.duration)
  }

  if ('aspectRatio' in req && req.aspectRatio) {
    body.aspect_ratio = req.aspectRatio
  }

  if ('generate_audio' in req && req.generate_audio !== undefined) {
    body.generate_audio = req.generate_audio
  }

  if (hasAssets) {
    if (req.model === 'grok-video') {
      const m = await materializeAsset(req.input_assets![0], 'url')
      body.image_url = m.url
      body.resolution = '720p'
    } else {
      // kling: image_urls array
      const urls: string[] = []
      for (const asset of req.input_assets!) {
        const m = await materializeAsset(asset, 'url')
        if (m.url) urls.push(m.url)
      }
      body.image_urls = urls
    }
  }

  return this.submitToQueue(modelPath, body)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/fal.test.ts`
Expected: 8 tests pass

- [ ] **Step 6: Run full suite**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/fal.ts server/test/adapters/fal.test.ts server/test/fixtures/fal/nano-banana-submit.json
git commit -m "feat(server): fal adapter — correct kling/grok-video paths + add nano-banana image support

- kling-2.6 + kling-3.0 → fal-ai/kling-video/o3/pro/reference-to-video
- grok-video → xai/grok-imagine-video/image-to-video (with resolution:720p)
- Add nano-banana-pro + nano-banana-2 image generation (T2I + I2I)
- Fix kling body: duration as int, image_urls array
- Fix grok-video body: image_url singular + resolution field

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Rewrite `luma.ts` — switch to team proxy

**Files:**
- Modify: `server/src/adapters/luma.ts`
- Modify: `server/test/adapters/luma.test.ts`

Key facts from Python `luma_images.py`:
- Base URL: `settings.LUMA_PROXY_BASE_URL` (env var, default `https://luma.bragi.now`)
- Auth: `Bearer ${LUMA_PROXY_BEARER_TOKEN}`
- T2I: `POST /v1/images/generate` body: `{ prompt, aspect_ratio, output_format: "png" }`
- I2I: `POST /v1/images/img2img` body: T2I + `image_url: refs[0]`
- Response: `{ image_url }` → SyncResult
- Supported ratios: `1:1, 16:9, 9:16, 3:2, 2:3` → else fallback `16:9`
- Max prompt: 6000 chars (truncate with `\n\n[truncated]`)
- **Video (luma-uni-1)**: Keep current `videoGeneration` using direct Luma API — team uses luma image-only, but our luma-uni-1 is video. Keep video as-is with a note.

Constructor change: `LumaAdapter` now takes `{ bearerToken, baseUrl }` instead of `token`.

- [ ] **Step 1: Update luma test**

```typescript
// server/test/adapters/luma.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import errorFx from '../fixtures/luma/error-400.json' with { type: 'json' }
import videoSubmitFx from '../fixtures/luma/video-submit.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/luma/task-completed.json' with { type: 'json' }
import { LumaAdapter } from '../../src/adapters/luma.js'

const PROXY_BASE = 'https://luma.bragi.now'
const VIDEO_BASE = 'https://api.lumalabs.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('LumaAdapter — image (proxy)', () => {
  it('imageGeneration T2I returns SyncResult with image URL', async () => {
    nock(PROXY_BASE)
      .post('/v1/images/generate')
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-abc123.png' })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'a beautiful landscape',
      aspectRatio: '16:9',
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs[0].kind).toBe('image')
    expect(result.outputs[0].url).toContain('img-abc123.png')
    expect(result.provider).toBe('luma')
  })

  it('imageGeneration I2I uses /v1/images/img2img endpoint', async () => {
    nock(PROXY_BASE)
      .post('/v1/images/img2img')
      .reply(200, { image_url: 'https://luma.bragi.now/output/edit-abc123.png' })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'make it blue',
      aspectRatio: '1:1',
      input_assets: [{ kind: 'url', url: 'https://example.com/ref.png' }],
    })

    if (result.status !== 'succeeded') throw new Error('expected succeeded')
    expect(result.outputs[0].url).toContain('edit-abc123.png')
  })

  it('prompt longer than 6000 chars gets truncated', async () => {
    let capturedBody: any = null
    nock(PROXY_BASE)
      .post('/v1/images/generate', (body) => { capturedBody = body; return true })
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-truncated.png' })

    const longPrompt = 'a'.repeat(7000)
    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: longPrompt,
      aspectRatio: '16:9',
    })

    expect(capturedBody.prompt.length).toBeLessThanOrEqual(6000)
    expect(capturedBody.prompt).toContain('[truncated]')
  })

  it('unsupported aspect ratio falls back to 16:9', async () => {
    let capturedBody: any = null
    nock(PROXY_BASE)
      .post('/v1/images/generate', (body) => { capturedBody = body; return true })
      .reply(200, { image_url: 'https://luma.bragi.now/output/img-fb.png' })

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await adapter.imageGeneration!({
      model: 'luma-uni-1',
      prompt: 'test',
      aspectRatio: '4:3',  // not in supported set
    })

    expect(capturedBody.aspect_ratio).toBe('16:9')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(PROXY_BASE)
      .post('/v1/images/generate')
      .reply(400, errorFx)

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'luma-uni-1',
        prompt: 'bad request',
        aspectRatio: '16:9',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})

describe('LumaAdapter — video (direct Luma API)', () => {
  it('videoGeneration returns AsyncResult with provider_task_id', async () => {
    nock(VIDEO_BASE)
      .post('/dream-machine/v1/generations')
      .reply(200, videoSubmitFx)

    const adapter = new LumaAdapter({ bearerToken: 'luma-proxy-token', baseUrl: PROXY_BASE })
    const result = await adapter.videoGeneration!({
      model: 'luma-uni-1',
      prompt: 'a cinematic sunset over the ocean',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('luma')
    expect(result.provider_task_id).toBe(videoSubmitFx.id)
  })
})
```

- [ ] **Step 2: Run test to confirm failures**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/luma.test.ts`
Expected: FAIL

- [ ] **Step 3: Rewrite `luma.ts`**

```typescript
/**
 * Luma Adapter
 *
 * Image (sync): luma-uni-1 → team proxy at LUMA_PROXY_BASE_URL
 *   T2I: POST /v1/images/generate
 *   I2I: POST /v1/images/img2img  (when input_assets present)
 *   Response: { image_url } → SyncResult
 *   Auth: Bearer LUMA_PROXY_BEARER_TOKEN
 *
 * Video (async): luma-uni-1 → direct Luma AI API (kept for V1)
 *   POST https://api.lumalabs.ai/dream-machine/v1/generations
 *   Auth: Bearer LUMA_PROXY_BEARER_TOKEN (same token used for proxy)
 *
 * Ground truth: apps/backend/app/core/luma_images.py
 */

import type { Adapter, SyncResult, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'
import type { VideosGenerationsRequest } from '../schemas/videos-generations.js'
import { materializeAsset } from './materialize-asset.js'

const VIDEO_BASE = 'https://api.lumalabs.ai/dream-machine/v1'
const LUMA_POLL_AFTER_MS = 5_000

const SUPPORTED_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '3:2', '2:3'])
const MAX_PROMPT_CHARS = 6000
const TRUNCATION_SUFFIX = '\n\n[truncated]'

function normalizeAspectRatio(ar: string): string {
  return SUPPORTED_ASPECT_RATIOS.has(ar) ? ar : '16:9'
}

function truncatePrompt(prompt: string): string {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt
  const keep = MAX_PROMPT_CHARS - TRUNCATION_SUFFIX.length
  return prompt.slice(0, keep).trimEnd() + TRUNCATION_SUFFIX
}

export class LumaAdapter implements Adapter {
  readonly name = 'luma'

  private readonly bearerToken: string
  private readonly proxyBaseUrl: string

  constructor(config: { bearerToken: string; baseUrl: string }) {
    this.bearerToken = config.bearerToken
    this.proxyBaseUrl = config.baseUrl.replace(/\/$/, '')
  }

  private async callProxy(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    const res = await fetch(`${this.proxyBaseUrl}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const message = parsed?.detail ?? parsed?.error?.message ?? parsed?.message ?? `Luma ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), res.status === 429 ? 503 : res.status, parsed)
    }
    return parsed
  }

  private async callVideoApi(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    const res = await fetch(`${VIDEO_BASE}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const message = parsed?.detail ?? parsed?.error?.message ?? parsed?.message ?? `Luma ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), res.status === 429 ? 503 : res.status, parsed)
    }
    return parsed
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'luma-uni-1' }>,
  ): Promise<SyncResult> {
    const t0 = Date.now()
    const hasAssets = req.input_assets && req.input_assets.length > 0

    const payload: Record<string, unknown> = {
      prompt: truncatePrompt(req.prompt),
      aspect_ratio: normalizeAspectRatio(req.aspectRatio ?? '16:9'),
      output_format: 'png',
    }

    let endpoint = '/v1/images/generate'
    if (hasAssets) {
      const m = await materializeAsset(req.input_assets![0], 'url')
      endpoint = '/v1/images/img2img'
      payload.image_url = m.url
    }

    const r: any = await this.callProxy('POST', endpoint, payload)
    const imageUrl: string = r.image_url
    if (!imageUrl) {
      throw new ApiError('provider_unavailable', `Luma proxy returned no image_url: ${JSON.stringify(r)}`, 502, r)
    }

    return {
      status: 'succeeded',
      outputs: [{ kind: 'image', url: imageUrl, mime_type: 'image/png' }],
      provider: 'luma',
      model: req.model,
      latency_ms: Date.now() - t0,
    }
  }

  async videoGeneration(
    req: Extract<VideosGenerationsRequest, { model: 'luma-uni-1' }>,
  ): Promise<AsyncResult> {
    const body: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio,
    }

    if (req.input_assets && req.input_assets.length > 0) {
      const keyframes: Record<string, unknown> = {}
      if (req.input_assets[0]) {
        const m = await materializeAsset(req.input_assets[0], 'url')
        keyframes.frame0 = { type: 'image', url: m.url }
      }
      if (req.input_assets[1]) {
        const m = await materializeAsset(req.input_assets[1], 'url')
        keyframes.frame1 = { type: 'image', url: m.url }
      }
      body.keyframes = keyframes
    }

    const r: any = await this.callVideoApi('POST', '/generations', body)

    return {
      status: 'queued',
      provider: 'luma',
      provider_task_id: r.id as string,
      poll_after_ms: LUMA_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.callVideoApi('GET', `/generations/${taskId}`)
    const state: string = r.state

    if (state === 'failed') {
      return {
        status: 'failed',
        error: { code: 'provider_unavailable', message: r.failure_reason ?? r.error ?? 'Luma task failed', provider_raw: r },
        latency_ms: Date.now() - t0,
      }
    }
    if (state === 'queued' || state === 'dreaming') {
      return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: LUMA_POLL_AFTER_MS }
    }
    if (state === 'completed') {
      return {
        status: 'succeeded',
        outputs: [{ kind: 'video', url: r.assets?.video, mime_type: 'video/mp4' }],
        latency_ms: Date.now() - t0,
      }
    }
    return { status: 'running', latency_ms: Date.now() - t0, poll_after_ms: LUMA_POLL_AFTER_MS }
  }
}
```

- [ ] **Step 4: Update `src/adapters/index.ts` — luma case uses new constructor**

```typescript
case 'luma': {
  const bt = E.LUMA_PROXY_BEARER_TOKEN
  const bu = E.LUMA_PROXY_BASE_URL ?? 'https://luma.bragi.now'
  if (bt) a = new LumaAdapter({ bearerToken: bt, baseUrl: bu })
  break
}
```

- [ ] **Step 5: Run test to verify passes**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/luma.test.ts`
Expected: 5 tests pass

- [ ] **Step 6: Run full suite**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/luma.ts server/src/adapters/index.ts server/test/adapters/luma.test.ts
git commit -m "feat(server): luma adapter — switch to team proxy for image generation

- Image: POST /v1/images/generate (T2I) and /v1/images/img2img (I2I)
  via LUMA_PROXY_BASE_URL with LUMA_PROXY_BEARER_TOKEN auth
- Prompt truncation at 6000 chars with truncation suffix
- Aspect ratio validation: only 1:1/16:9/9:16/3:2/2:3 supported, else 16:9
- Video: keep direct Luma AI API (luma-uni-1 video unchanged)
- Constructor changed to { bearerToken, baseUrl }

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Fix `xai.ts` — image model + aspect_ratio + resolution + edit endpoint

**Files:**
- Modify: `server/src/adapters/xai.ts`
- (No test changes needed — existing tests still pass with new model name)

Key facts from `xai_images.py`:
- Image model: `grok-imagine-image-quality` (was `grok-imagine-image`)
- T2I body: `{ model, prompt, aspect_ratio, resolution: "2k", n: 1 }`
- Edit (I2I): `POST /v1/images/edits` with `image: {type:"image_url",url}` or `images: [...]`
- Response: `{ data: [{ b64_json?, url? }] }` — prefer b64_json

Note: Our current adapter returns URL outputs. The Python reference downloads bytes. We keep URL pattern since our router returns URLs to clients. The key fix is the model name and body fields.

- [ ] **Step 1: Update IMAGE_MODEL_MAP and body fields in `xai.ts`**

Changes:
```typescript
const IMAGE_MODEL_MAP: Record<string, string> = {
  'grok-imagine': 'grok-imagine-image-quality',
}
```

Update imageGeneration body:
```typescript
const r: any = await this.callJson('POST', '/images/generations', {
  model: upstreamModel,
  prompt: req.prompt,
  aspect_ratio: req.aspectRatio ?? '16:9',
  resolution: '2k',
  n: 1,
})
```

Response handling — prefer `b64_json`, fall back to `url`:
```typescript
const outputs = (r.data as Array<{ url?: string; b64_json?: string }>).map(d => ({
  kind: 'image' as const,
  // b64_json means xAI returned inline — encode as data URI
  url: d.url ?? (d.b64_json ? `data:image/png;base64,${d.b64_json}` : undefined),
  mime_type: 'image/png',
}))
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/xai.test.ts`
Expected: 3 tests pass (fixture has `url` field, so b64 path not exercised but that's fine)

- [ ] **Step 3: Run full suite**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/xai.ts
git commit -m "fix(server): xai adapter — image model is grok-imagine-image-quality

- Upstream model: grok-imagine-image-quality (was grok-imagine-image)
- Add aspect_ratio + resolution:2k to T2I body per xai_images.py reference
- Handle b64_json response by encoding as data URI fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Extend `tokenrouter.ts` — add OpenAI and Gemini chat models

**Files:**
- Modify: `server/src/adapters/tokenrouter.ts`
- Modify: `server/test/adapters/tokenrouter.test.ts`

Key facts from `apps/backend/app/core/config.py`:
- `gpt-5.4-pro` → `openai/gpt-5.5`
- `gemini-3.1-pro` → `google/gemini-3.1-pro-preview`
- `gemini-3-flash` → best guess: `google/gemini-3-flash-preview` (team only has gemini-3.1-pro-preview in config; gemini-3-flash not found in monorepo — use this name)
- TokenRouter is OpenAI-compatible — same code path

- [ ] **Step 1: Update tokenrouter test with new models**

Add to `server/test/adapters/tokenrouter.test.ts`:
```typescript
it('chatCompletion gpt-5.4-pro maps to openai/gpt-5.5', async () => {
  let capturedBody: any = null
  nock(BASE)
    .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
    .reply(200, chatFx)

  const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
  const result = await adapter.chatCompletion!({
    model: 'gpt-5.4-pro',
    messages: [{ role: 'user', content: 'Hello' }],
  })

  expect(result.status).toBe('succeeded')
  expect(capturedBody.model).toBe('openai/gpt-5.5')
  expect(result.model).toBe('gpt-5.4-pro')
})

it('chatCompletion gemini-3.1-pro maps to google/gemini-3.1-pro-preview', async () => {
  let capturedBody: any = null
  nock(BASE)
    .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
    .reply(200, chatFx)

  const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
  const result = await adapter.chatCompletion!({
    model: 'gemini-3.1-pro',
    messages: [{ role: 'user', content: 'Hello' }],
  })

  expect(result.status).toBe('succeeded')
  expect(capturedBody.model).toBe('google/gemini-3.1-pro-preview')
  expect(result.model).toBe('gemini-3.1-pro')
})

it('chatCompletion gemini-3-flash maps to google/gemini-3-flash-preview', async () => {
  let capturedBody: any = null
  nock(BASE)
    .post('/v1/chat/completions', (body) => { capturedBody = body; return true })
    .reply(200, chatFx)

  const adapter = new TokenrouterAdapter('sk-tokenrouter-test-key')
  const result = await adapter.chatCompletion!({
    model: 'gemini-3-flash',
    messages: [{ role: 'user', content: 'Hello' }],
  })

  expect(result.status).toBe('succeeded')
  expect(capturedBody.model).toBe('google/gemini-3-flash-preview')
})
```

- [ ] **Step 2: Run test to confirm new tests fail**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/tokenrouter.test.ts`
Expected: 2 new tests pass (because fallback is model ID itself), but model mapping assertions fail

- [ ] **Step 3: Update MODEL_MAP in `tokenrouter.ts`**

```typescript
const MODEL_MAP: Record<string, string> = {
  'qwen-3-6-plus':  'qwen/qwen3.6-plus',
  'gpt-5.4-pro':    'openai/gpt-5.5',
  'gemini-3.1-pro': 'google/gemini-3.1-pro-preview',
  'gemini-3-flash': 'google/gemini-3-flash-preview',
}
```

Also widen the `chatCompletion` type signature to accept any model ID (not just `qwen-3-6-plus`):
```typescript
async chatCompletion(
  req: ChatCompletionsRequest,  // accept any chat model
): Promise<SyncResult> {
```

- [ ] **Step 4: Run test to verify passes**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/tokenrouter.test.ts`
Expected: 5 tests pass

- [ ] **Step 5: Run full suite**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/tokenrouter.ts server/test/adapters/tokenrouter.test.ts
git commit -m "feat(server): tokenrouter adapter — support multi-model chat (openai+gemini)

- gpt-5.4-pro → openai/gpt-5.5
- gemini-3.1-pro → google/gemini-3.1-pro-preview
- gemini-3-flash → google/gemini-3-flash-preview
- qwen-3-6-plus → qwen/qwen3.6-plus (unchanged)
- Widen chatCompletion signature to accept any ChatCompletionsRequest

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Create `apimart.ts` adapter + tests

**Files:**
- Create: `server/src/adapters/apimart.ts`
- Create: `server/test/adapters/apimart.test.ts`
- Create: `server/test/fixtures/apimart/submit-success.json`
- Create: `server/test/fixtures/apimart/task-completed.json`
- Create: `server/test/fixtures/apimart/error-400.json`

Key facts from `apimart_images.py`:
- Base URL: `settings.APIMART_BASE_URL` (default `https://api.apimart.ai`)
- Auth: `Bearer APIMART_API_KEY`
- Submit: `POST /v1/images/generations` body: `{ model: "gpt-image-2", prompt, n:1, size, resolution: "2k" }`
  where `size` = aspect ratio string if supported, else `"auto"`
- Submit response: `{ data: [{ task_id }] }`
- Poll: `GET /v1/tasks/{task_id}`
- Poll response: `{ data: { status, result: { images: [{url}] } } }` or top-level
  - status `"completed"` → extract `result.images[0].url`
  - status `"failed"` → error
  - other → still running
- Returns AsyncResult (task_id based)

- [ ] **Step 1: Create test fixtures**

`server/test/fixtures/apimart/submit-success.json`:
```json
{
  "data": [
    {
      "task_id": "apimart-task-abc123",
      "status": "pending"
    }
  ]
}
```

`server/test/fixtures/apimart/task-completed.json`:
```json
{
  "data": {
    "task_id": "apimart-task-abc123",
    "status": "completed",
    "result": {
      "images": [
        {
          "url": "https://api.apimart.ai/output/gpt-image-result-abc123.png"
        }
      ]
    }
  }
}
```

`server/test/fixtures/apimart/error-400.json`:
```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "invalid_prompt",
    "message": "Prompt contains invalid content"
  }
}
```

- [ ] **Step 2: Create apimart test**

`server/test/adapters/apimart.test.ts`:
```typescript
import { describe, it, expect, afterEach } from 'vitest'
import nock from 'nock'
import submitFx from '../fixtures/apimart/submit-success.json' with { type: 'json' }
import taskCompletedFx from '../fixtures/apimart/task-completed.json' with { type: 'json' }
import errorFx from '../fixtures/apimart/error-400.json' with { type: 'json' }
import { ApimartAdapter } from '../../src/adapters/apimart.js'

const BASE = 'https://api.apimart.ai'

afterEach(() => {
  nock.cleanAll()
})

describe('ApimartAdapter', () => {
  it('imageGeneration submits task and returns AsyncResult', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'a beautiful landscape',
      aspectRatio: '16:9',
    })

    expect(result.status).toBe('queued')
    expect(result.provider).toBe('apimart')
    expect(result.provider_task_id).toBe('apimart-task-abc123')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns succeeded with image output on completion', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-abc123')
      .reply(200, taskCompletedFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-abc123')

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toBeDefined()
    expect(result.outputs![0].kind).toBe('image')
    expect(result.outputs![0].url).toContain('gpt-image-result-abc123.png')
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('taskStatus returns running for pending status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-pending')
      .reply(200, { data: { status: 'pending', task_id: 'apimart-task-pending' } })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-pending')

    expect(result.status).toBe('running')
    expect(result.poll_after_ms).toBeGreaterThan(0)
  })

  it('taskStatus returns failed on failed status', async () => {
    nock(BASE)
      .get('/v1/tasks/apimart-task-fail')
      .reply(200, {
        data: { status: 'failed', error: { message: 'Content policy violation' } },
      })

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    const result = await adapter.taskStatus!('apimart-task-fail')

    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('provider_rejected')
  })

  it('imageGeneration sends correct model name and size', async () => {
    let capturedBody: any = null
    nock(BASE)
      .post('/v1/images/generations', (body) => { capturedBody = body; return true })
      .reply(200, submitFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await adapter.imageGeneration!({
      model: 'gpt-image-2',
      prompt: 'test',
      aspectRatio: '9:16',
    })

    expect(capturedBody.model).toBe('gpt-image-2')
    expect(capturedBody.size).toBe('9:16')
    expect(capturedBody.resolution).toBe('2k')
  })

  it('4xx error maps to provider_invalid_request', async () => {
    nock(BASE)
      .post('/v1/images/generations')
      .reply(400, errorFx)

    const adapter = new ApimartAdapter({ apiKey: 'sk-apimart-test', baseUrl: BASE })
    await expect(
      adapter.imageGeneration!({
        model: 'gpt-image-2',
        prompt: 'bad request',
        aspectRatio: '1:1',
      })
    ).rejects.toMatchObject({ code: 'provider_invalid_request' })
  })
})
```

- [ ] **Step 3: Run test to confirm failures (adapter doesn't exist yet)**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/apimart.test.ts`
Expected: FAIL — no ApimartAdapter

- [ ] **Step 4: Create `server/src/adapters/apimart.ts`**

```typescript
/**
 * Apimart Adapter — gpt-image-2 proxy
 *
 * Supported models:
 *   Image (async): gpt-image-2
 *
 * Auth: Bearer ${APIMART_API_KEY}
 * Base: APIMART_BASE_URL (default https://api.apimart.ai)
 *
 * Ground truth: apps/backend/app/core/apimart_images.py
 *
 * Flow: POST /v1/images/generations → { data: [{ task_id }] }
 *       GET  /v1/tasks/{task_id}    → { data: { status, result: { images: [{url}] } } }
 */

import type { Adapter, AsyncResult, TaskStatusResult } from './types.js'
import { ApiError } from '../errors.js'
import type { ImagesGenerationsRequest } from '../schemas/images-generations.js'

const APIMART_POLL_AFTER_MS = 5_000

const SUPPORTED_SIZES = new Set([
  'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '21:9', '9:21', '7:9', '9:7',
])

function resolveSize(aspectRatio: string): string {
  return SUPPORTED_SIZES.has(aspectRatio) ? aspectRatio : 'auto'
}

export class ApimartAdapter implements Adapter {
  readonly name = 'apimart'

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: { apiKey: string; baseUrl: string }) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/$/, '')
  }

  private async call(method: 'POST' | 'GET', path: string, body?: unknown): Promise<unknown> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
    }
    if (body !== undefined) init.body = JSON.stringify(body)

    const res = await fetch(`${this.baseUrl}${path}`, init)
    const text = await res.text()
    let parsed: any
    try { parsed = JSON.parse(text) } catch { parsed = text }

    if (!res.ok) {
      const code = res.status >= 500 ? 'provider_unavailable' : 'provider_invalid_request'
      const err = parsed?.error ?? {}
      const message = err.message ?? `Apimart ${res.status}`
      throw new ApiError(code, typeof message === 'string' ? message : JSON.stringify(message), res.status === 429 ? 503 : res.status, parsed)
    }
    return parsed
  }

  async imageGeneration(
    req: Extract<ImagesGenerationsRequest, { model: 'gpt-image-2' }>,
  ): Promise<AsyncResult> {
    const size = resolveSize(req.aspectRatio ?? '16:9')

    const body = {
      model: 'gpt-image-2',
      prompt: req.prompt,
      n: 1,
      size,
      resolution: '2k',
    }

    const r: any = await this.call('POST', '/v1/images/generations', body)

    const items = r.data ?? []
    const taskId: string = items[0]?.task_id
    if (!taskId) {
      throw new ApiError('provider_unavailable', `Apimart returned no task_id: ${JSON.stringify(r)}`, 502, r)
    }

    return {
      status: 'queued',
      provider: 'apimart',
      provider_task_id: taskId,
      poll_after_ms: APIMART_POLL_AFTER_MS,
    }
  }

  async taskStatus(taskId: string): Promise<TaskStatusResult> {
    const t0 = Date.now()
    const r: any = await this.call('GET', `/v1/tasks/${taskId}`)

    // Apimart wraps status under either top-level or `data`
    const node: any = (r.data && typeof r.data === 'object') ? r.data : r
    const status: string = (node.status ?? '').toLowerCase()

    if (status === 'completed') {
      const result = node.result ?? {}
      const images: Array<any> = result.images ?? []
      const urlField = images[0]?.url
      const url = Array.isArray(urlField) ? urlField[0] : urlField
      if (!url) {
        return {
          status: 'failed',
          error: { code: 'provider_unavailable', message: `Apimart completed but no image URL: ${JSON.stringify(r)}` },
          latency_ms: Date.now() - t0,
        }
      }
      return {
        status: 'succeeded',
        outputs: [{ kind: 'image', url, mime_type: 'image/png' }],
        latency_ms: Date.now() - t0,
      }
    }

    if (status === 'failed') {
      const err = node.error ?? {}
      const msg = err.message ?? 'Apimart task failed'
      // Check if it's a moderation/rejection
      const isRejected = ['moderation', 'content_policy', 'safety', 'blocked', 'restriction']
        .some(kw => msg.toLowerCase().includes(kw))
      return {
        status: 'failed',
        error: {
          code: isRejected ? 'provider_rejected' : 'provider_unavailable',
          message: msg,
          provider_raw: node.error,
        },
        latency_ms: Date.now() - t0,
      }
    }

    // pending / processing / unknown → still running
    return {
      status: 'running',
      latency_ms: Date.now() - t0,
      poll_after_ms: APIMART_POLL_AFTER_MS,
    }
  }
}
```

- [ ] **Step 5: Run test to verify passes**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test test/adapters/apimart.test.ts`
Expected: 6 tests pass

- [ ] **Step 6: Run full suite**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass

- [ ] **Step 7: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/adapters/apimart.ts server/test/adapters/apimart.test.ts server/test/fixtures/apimart/
git commit -m "feat(server): apimart adapter for gpt-image-2

- Async image generation via apimart proxy
- Submit: POST /v1/images/generations → task_id
- Poll: GET /v1/tasks/{task_id} → completed/failed/pending
- Size: aspect ratio strings passed directly (supported set from apimart_images.py)
- Resolution: 2k (matches team config)
- Error classification: moderation keywords → provider_rejected

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Update Registry + Provider type + env + adapter factory

**Files:**
- Modify: `server/src/registry.ts`
- Modify: `server/src/env.ts`
- Modify: `server/.env.example`
- Modify: `server/src/adapters/index.ts`
- Modify: `server/src/adapters/legnext.ts`
- Modify: `server/test/registry.test.ts`
- Modify: `server/test/adapters/index.test.ts`

- [ ] **Step 1: Update `registry.ts`**

```typescript
export type Provider = 'openai' | 'gemini' | 'byteplus' | 'fal' | 'luma' | 'xai' | 'legnext' | 'tokenrouter' | 'apimart'

const REGISTRY: Record<string, RegistryEntry> = {
  // image
  'gpt-image-2':        { provider: 'apimart',     capability: 'image', async: true  },  // was openai/sync
  'nano-banana-pro':    { provider: 'fal',         capability: 'image', async: true  },  // was gemini/sync
  'nano-banana-2':      { provider: 'fal',         capability: 'image', async: true  },  // was gemini/sync
  'seedream-4.5':       { provider: 'byteplus',    capability: 'image', async: false },
  'seedream-5.0':       { provider: 'byteplus',    capability: 'image', async: false },
  'grok-imagine':       { provider: 'xai',         capability: 'image', async: false },
  'midjourney-v8':      { provider: 'legnext',     capability: 'image', async: true  },
  'midjourney-niji-7':  { provider: 'legnext',     capability: 'image', async: true  },

  // video
  'kling-2.6':          { provider: 'fal',         capability: 'video', async: true },
  'kling-3.0':          { provider: 'fal',         capability: 'video', async: true },
  'grok-video':         { provider: 'fal',         capability: 'video', async: true },
  'seedance-2.0':       { provider: 'byteplus',    capability: 'video', async: true },
  'seedance-2.0-fast':  { provider: 'byteplus',    capability: 'video', async: true },
  'veo-3.1':            { provider: 'gemini',      capability: 'video', async: true },
  'veo-3.1-lite':       { provider: 'gemini',      capability: 'video', async: true },
  'luma-uni-1':         { provider: 'luma',        capability: 'video', async: true },

  // text — gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro now via tokenrouter
  'gemini-3-flash':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gemini-3.1-pro':     { provider: 'tokenrouter', capability: 'text', async: false },
  'gpt-5.4-pro':        { provider: 'tokenrouter', capability: 'text', async: false },
  'qwen-3-6-plus':      { provider: 'tokenrouter', capability: 'text', async: false },

  // audio
  'grok-tts':           { provider: 'xai',  capability: 'audio', async: false },
  'elevenlabs-tts-v3':  { provider: 'fal',  capability: 'audio', async: true  },
  'elevenlabs-music':   { provider: 'fal',  capability: 'audio', async: true  },
  'elevenlabs-sfx':     { provider: 'fal',  capability: 'audio', async: true  },
}
```

- [ ] **Step 2: Update `env.ts`**

```typescript
const EnvSchema = z.object({
  PORT: z.string().default('8787').transform(Number),
  ROUTER_PUBLIC_URL: z.string().url(),
  ASSET_TTL_SECONDS: z.string().default('3600').transform(Number),
  ASSET_SIGNING_SECRET: z.string().min(16),
  ASSET_TMP_DIR: z.string().default('./tmp'),
  BRAGI_TOKENS: z.string().transform(s => new Set(s.split(',').map(t => t.trim()).filter(Boolean))),
  OPENAI_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  BYTEPLUS_API_KEY: z.string().optional(),
  BYTEPLUS_ACCESS_KEY: z.string().optional(),
  BYTEPLUS_SECRET_KEY: z.string().optional(),
  BYTEPLUS_PROJECT: z.string().optional(),
  FAL_API_KEY: z.string().optional(),
  LUMA_TOKEN: z.string().optional(),
  LUMA_PROXY_BEARER_TOKEN: z.string().optional(),
  LUMA_PROXY_BASE_URL: z.string().optional().default('https://luma.bragi.now'),
  XAI_API_KEY: z.string().optional(),
  LEGNEXT_API_KEY: z.string().optional(),
  TOKENROUTER_API_KEY: z.string().optional(),
  APIMART_API_KEY: z.string().optional(),
  APIMART_BASE_URL: z.string().optional().default('https://api.apimart.ai'),
})
```

- [ ] **Step 3: Update `.env.example`**

Append to the file:
```
LUMA_PROXY_BEARER_TOKEN=
LUMA_PROXY_BASE_URL=https://luma.bragi.now
APIMART_API_KEY=
APIMART_BASE_URL=https://api.apimart.ai
```

- [ ] **Step 4: Update `index.ts` adapter factory — add apimart case**

Add to the switch:
```typescript
case 'apimart': {
  const k = E.APIMART_API_KEY
  const bu = E.APIMART_BASE_URL ?? 'https://api.apimart.ai'
  if (k) a = new ApimartAdapter({ apiKey: k, baseUrl: bu })
  break
}
```

And import `ApimartAdapter`:
```typescript
import { ApimartAdapter } from './apimart.js'
```

- [ ] **Step 5: Update `legnext.ts` — midjourney throws 501**

Replace `imageGeneration` body in `legnext.ts`:
```typescript
async imageGeneration(
  req: Extract<ImagesGenerationsRequest, { model: 'midjourney-v8' | 'midjourney-niji-7' }>,
): Promise<AsyncResult> {
  throw new ApiError(
    'unknown_model',
    `${req.model} is not supported in V1. Contact team for Midjourney access.`,
    501,
    null,
  )
}
```

- [ ] **Step 6: Update registry tests**

Updated `server/test/registry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { lookupModel, ALL_MODEL_IDS } from '../src/registry.js'

describe('registry', () => {
  it('looks up gpt-image-2 → apimart/image/async', () => {
    const r = lookupModel('gpt-image-2')
    expect(r).toEqual({ provider: 'apimart', capability: 'image', async: true })
  })

  it('looks up kling-3.0 → fal/video/async', () => {
    const r = lookupModel('kling-3.0')
    expect(r).toEqual({ provider: 'fal', capability: 'video', async: true })
  })

  it('looks up gpt-5.4-pro → tokenrouter/text/sync', () => {
    const r = lookupModel('gpt-5.4-pro')
    expect(r).toEqual({ provider: 'tokenrouter', capability: 'text', async: false })
  })

  it('looks up gemini-3-flash → tokenrouter/text/sync', () => {
    const r = lookupModel('gemini-3-flash')
    expect(r).toEqual({ provider: 'tokenrouter', capability: 'text', async: false })
  })

  it('looks up nano-banana-pro → fal/image/async', () => {
    const r = lookupModel('nano-banana-pro')
    expect(r).toEqual({ provider: 'fal', capability: 'image', async: true })
  })

  it('returns undefined for unknown model', () => {
    expect(lookupModel('does-not-exist')).toBeUndefined()
  })

  it('exports 13+ enabled model ids', () => {
    expect(ALL_MODEL_IDS.length).toBeGreaterThanOrEqual(13)
  })
})
```

- [ ] **Step 7: Update index.test.ts — add apimart test**

Add to `server/test/adapters/index.test.ts`:
```typescript
it('throws provider_unavailable for apimart when key missing', () => {
  delete process.env.APIMART_API_KEY
  expect(() => adapterFor('apimart')).toThrow(/provider apimart not configured/)
})

it('returns ApimartAdapter when APIMART_API_KEY present', () => {
  process.env.APIMART_API_KEY = 'sk-apimart-test'
  const a = adapterFor('apimart')
  expect(a.name).toBe('apimart')
})
```

Also add `delete process.env.APIMART_API_KEY` to the `beforeEach`.

- [ ] **Step 8: Run tests**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All pass (fix any failures before proceeding)

- [ ] **Step 9: Commit**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
git add server/src/registry.ts server/src/env.ts server/.env.example \
        server/src/adapters/index.ts server/src/adapters/legnext.ts \
        server/test/registry.test.ts server/test/adapters/index.test.ts
git commit -m "feat(server): registry — re-route 6 models + add apimart provider

- gpt-image-2: openai → apimart (async)
- nano-banana-pro, nano-banana-2: gemini → fal (async)
- gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro: → tokenrouter
- Provider type: add 'apimart'
- env.ts: add APIMART_API_KEY, LUMA_PROXY_BEARER_TOKEN, LUMA_PROXY_BASE_URL
- legnext: midjourney throws 501 unknown_model
- adapter factory: add apimart case

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Sync env secrets + redeploy + re-smoke

**Files:**
- Modify: `server/.env` (append LUMA + APIMART secrets, no printing)

- [ ] **Step 1: Append LUMA secrets to local .env (DO NOT print values)**

```bash
LUMA_TOKEN_LINE=$(grep '^LUMA_PROXY_BEARER_TOKEN=' /Users/weichu/Documents/storyverse-monorepo/apps/backend/.env | cut -d= -f2-)
LUMA_BASE_LINE=$(grep '^LUMA_PROXY_BASE_URL=' /Users/weichu/Documents/storyverse-monorepo/apps/backend/.env | cut -d= -f2-)
APIMART_KEY_LINE=$(grep '^APIMART_API_KEY=' /Users/weichu/Documents/storyverse-monorepo/apps/backend/.env | cut -d= -f2-)
APIMART_BASE_LINE=$(grep '^APIMART_BASE_URL=' /Users/weichu/Documents/storyverse-monorepo/apps/backend/.env | cut -d= -f2-)

# Only append if not already present
grep -q 'LUMA_PROXY_BEARER_TOKEN' /Users/weichu/Documents/canvas/bragi-canvas/server/.env || \
  echo "LUMA_PROXY_BEARER_TOKEN=$LUMA_TOKEN_LINE" >> /Users/weichu/Documents/canvas/bragi-canvas/server/.env

grep -q 'LUMA_PROXY_BASE_URL' /Users/weichu/Documents/canvas/bragi-canvas/server/.env || \
  echo "LUMA_PROXY_BASE_URL=$LUMA_BASE_LINE" >> /Users/weichu/Documents/canvas/bragi-canvas/server/.env

grep -q 'APIMART_API_KEY' /Users/weichu/Documents/canvas/bragi-canvas/server/.env || \
  echo "APIMART_API_KEY=$APIMART_KEY_LINE" >> /Users/weichu/Documents/canvas/bragi-canvas/server/.env

grep -q 'APIMART_BASE_URL' /Users/weichu/Documents/canvas/bragi-canvas/server/.env || \
  echo "APIMART_BASE_URL=$APIMART_BASE_LINE" >> /Users/weichu/Documents/canvas/bragi-canvas/server/.env

unset LUMA_TOKEN_LINE LUMA_BASE_LINE APIMART_KEY_LINE APIMART_BASE_LINE
```

Verify (count lines, not print values):
```bash
grep -c 'LUMA_PROXY_BEARER_TOKEN' /Users/weichu/Documents/canvas/bragi-canvas/server/.env
grep -c 'LUMA_PROXY_BASE_URL' /Users/weichu/Documents/canvas/bragi-canvas/server/.env
grep -c 'APIMART_API_KEY' /Users/weichu/Documents/canvas/bragi-canvas/server/.env
```
Expected: each returns `1`

- [ ] **Step 2: Run full test suite one final time**

Run: `cd /Users/weichu/Documents/canvas/bragi-canvas/server && pnpm test`
Expected: All tests pass

- [ ] **Step 3: Deploy to sv-dev**

```bash
cd /Users/weichu/Documents/canvas/bragi-canvas
./deploy/deploy.sh sv-dev
```

Expected: deploy script builds, rsync, systemctl restart, shows "active (running)"

- [ ] **Step 4: Verify deploy health**

```bash
ssh sv-dev 'sudo systemctl status bragi-router --no-pager | head -5'
ssh sv-dev 'curl -sf http://localhost:8787/health | head -c 200'
```

Expected: status active, health returns `{"status":"ok",...}`

- [ ] **Step 5: Copy .env to sv-dev server**

```bash
scp /Users/weichu/Documents/canvas/bragi-canvas/server/.env sv-dev:/tmp/.env-bragi-new
ssh sv-dev '
  sudo cp /etc/bragi-router/.env /etc/bragi-router/.env.bak
  sudo mv /tmp/.env-bragi-new /etc/bragi-router/.env
  sudo chown root:ubuntu /etc/bragi-router/.env
  sudo chmod 640 /etc/bragi-router/.env
  sudo systemctl restart bragi-router
  sleep 2
  sudo systemctl status bragi-router --no-pager | head -5
'
```

- [ ] **Step 6: Re-run smoke test from sv-dev**

```bash
ssh sv-dev '
BASE=https://35.168.148.47.nip.io
TOKEN=$BRAGI_TOKEN   # set BRAGI_TOKEN to your svsk- token

echo "=== TEXT ==="
for MODEL in gpt-5.4-pro gemini-3-flash gemini-3.1-pro qwen-3-6-plus; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST $BASE/v1/chat/completions \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}")
  echo "$MODEL: $STATUS"
done

echo "=== IMAGE (sync) ==="
for MODEL in seedream-4.5 seedream-5.0 grok-imagine; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST $BASE/v1/images/generations \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"a sunset\",\"aspectRatio\":\"16:9\"}")
  echo "$MODEL: $STATUS"
done

echo "=== IMAGE (async/task) ==="
for MODEL in gpt-image-2 nano-banana-pro nano-banana-2; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST $BASE/v1/images/generations \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"a sunset\",\"aspectRatio\":\"16:9\"}")
  echo "$MODEL: $STATUS"
done

echo "=== VIDEO ==="
for MODEL in kling-2.6 kling-3.0 grok-video seedance-2.0 seedance-2.0-fast luma-uni-1; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST $BASE/v1/videos/generations \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"a sunset\",\"aspectRatio\":\"16:9\"}")
  echo "$MODEL: $STATUS"
done

echo "=== NOT SUPPORTED (expect 501) ==="
for MODEL in veo-3.1 veo-3.1-lite midjourney-v8 midjourney-niji-7; do
  STATUS=$(curl -sf -o /dev/null -w "%{http_code}" -X POST $BASE/v1/videos/generations \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"model\":\"$MODEL\",\"prompt\":\"a sunset\"}")
  echo "$MODEL: $STATUS"
done
'
```

Expected classification after fixes:
- ✅ text: gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro, qwen-3-6-plus → 200
- ✅ image sync: seedream-4.5, seedream-5.0, grok-imagine → 200
- ✅ image async: gpt-image-2, nano-banana-pro, nano-banana-2 → 200 (task_id returned)
- ✅ video: kling-2.6, kling-3.0, grok-video, seedance-2.0, seedance-2.0-fast, luma-uni-1 → 200
- ❌ not-supported: veo-3.1, veo-3.1-lite → gemini adapter (still 501)
- ❌ not-supported: midjourney-v8, midjourney-niji-7 → legnext throws 501
- ❌ grok-tts → xai (user's problem if xAI key not set)

---

## Self-Review

**Spec coverage check:**
- ✅ A. Registry: gpt-image-2 → apimart, nano-banana → fal, gpt-5.4-pro/gemini → tokenrouter — Task 7
- ✅ B. Env: APIMART_API_KEY, LUMA_PROXY_BEARER_TOKEN, LUMA_PROXY_BASE_URL — Task 7
- ✅ C.1 Byteplus rewrite: Beijing URL, doubao names, size calc, correct body, error codes — Task 1
- ✅ C.2 Fal update: kling o3/pro path, grok-video path, nano-banana — Task 2
- ✅ C.3 Luma rewrite: proxy base URL + token, T2I + I2I, prompt truncation — Task 3
- ✅ C.4 xai fix: grok-imagine-image-quality, aspect_ratio, resolution — Task 4
- ✅ C.5 Tokenrouter extend: gpt-5.4-pro, gemini-3-flash, gemini-3.1-pro — Task 5
- ✅ C.6 Apimart adapter: async image generation, task polling — Task 6
- ✅ C.7 Gemini: veo-3.1/lite stay in registry pointing gemini; gemini adapter untouched (throws on unsupported) — no code needed, registry already does right thing
- ✅ C.8 Legnext: midjourney throws 501 — Task 7
- ✅ C.9 OpenAI: untouched (registry re-routes, adapter still works for other uses)
- ✅ D. Adapter factory: apimart case — Task 7
- ✅ E. LUMA secrets sync — Task 8
- ✅ F. Run all tests — after each task
- ✅ G. Redeploy — Task 8
- ✅ H. Re-smoke — Task 8
- ✅ I. Atomic commits — one per task

**Placeholder scan:** No TBD/TODO placeholders. All code is complete.

**Type consistency:**
- `ByteplusAdapter` exports `aspectRatioToSeeadreamSize` (exported for test import)
- `LumaAdapter` constructor takes `{ bearerToken, baseUrl }` — updated in index.ts
- `ApimartAdapter` constructor takes `{ apiKey, baseUrl }` — used in index.ts
- `chatCompletion` in tokenrouter accepts `ChatCompletionsRequest` (widened from specific union)

**Note on gemini-3-flash:** Team monorepo only has `google/gemini-3.1-pro-preview` and `openai/gpt-5.5`. The `gemini-3-flash` model is not in the team backend config. Using `google/gemini-3-flash-preview` is a best guess — TokenRouter might map it correctly. Mark as DONE_WITH_CONCERNS.
