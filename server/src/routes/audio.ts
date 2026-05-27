import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import type { ZodSchema } from 'zod'
import { AudioSpeechBody } from '../schemas/audio-speech.js'
import { AudioMusicBody } from '../schemas/audio-music.js'
import { AudioSfxBody } from '../schemas/audio-sfx.js'
import { resolveProvider } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const audioRoute = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = toErrorResponse(new ApiError('invalid_request', result.error.message, 400))
      return c.json(body, status)
    }
  },
})

const audioSpeechRoute = createRoute({
  method: 'post',
  path: '/audio/speech',
  tags: ['audio'],
  summary: 'Text-to-speech synthesis',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: AudioSpeechBody } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Generated audio bytes',
      content: {
        'audio/mpeg': { schema: { type: 'string', format: 'binary' } as unknown as ZodSchema },
        'audio/wav': { schema: { type: 'string', format: 'binary' } as unknown as ZodSchema },
        'audio/opus': { schema: { type: 'string', format: 'binary' } as unknown as ZodSchema },
        'audio/aac': { schema: { type: 'string', format: 'binary' } as unknown as ZodSchema },
        'audio/flac': { schema: { type: 'string', format: 'binary' } as unknown as ZodSchema },
      },
    },
    202: {
      description: 'Speech generation queued (async)',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation or unknown model error',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
    503: {
      description: 'Provider unavailable',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

const audioMusicRoute = createRoute({
  method: 'post',
  path: '/audio/music',
  tags: ['audio'],
  summary: 'Music generation (async)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: AudioMusicBody } },
      required: true,
    },
  },
  responses: {
    202: {
      description: 'Music generation queued',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation or unknown model error',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: z.any() } },
    },
    503: {
      description: 'Provider unavailable (upstream transport failure)',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

const audioSfxRoute = createRoute({
  method: 'post',
  path: '/audio/sfx',
  tags: ['audio'],
  summary: 'Sound effects generation (async)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: AudioSfxBody } },
      required: true,
    },
  },
  responses: {
    202: {
      description: 'SFX generation queued',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation or unknown model error',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
    500: {
      description: 'Internal error',
      content: { 'application/json': { schema: z.any() } },
    },
    503: {
      description: 'Provider unavailable (upstream transport failure)',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

audioRoute.openapi(audioSpeechRoute, async c => {
  const req = c.req.valid('json')
  const rawBody: any = await c.req.json().catch(() => ({}))
  const requestedProvider: string | undefined = typeof rawBody?.provider === 'string' ? rawBody.provider : undefined

  let entry: ReturnType<typeof resolveProvider>['entry']
  let provider: ReturnType<typeof resolveProvider>['provider']
  try {
    ;({ entry, provider } = resolveProvider(req.model, requestedProvider))
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }

  if (entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.audioSpeech) throw new ApiError('internal_error', `adapter missing audioSpeech`, 500)
    const r = await a.audioSpeech(req)
    if ('bytes' in r) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Response(new Uint8Array(r.bytes), { headers: { 'Content-Type': r.mimeType } }) as any
    }
    // AsyncResult
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})

audioRoute.openapi(audioMusicRoute, async c => {
  const req = c.req.valid('json')
  const rawBody: any = await c.req.json().catch(() => ({}))
  const requestedProvider: string | undefined = typeof rawBody?.provider === 'string' ? rawBody.provider : undefined

  let entry: ReturnType<typeof resolveProvider>['entry']
  let provider: ReturnType<typeof resolveProvider>['provider']
  try {
    ;({ entry, provider } = resolveProvider(req.model, requestedProvider))
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }

  if (entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.audioMusic) throw new ApiError('internal_error', `adapter missing audioMusic`, 500)
    const r = await a.audioMusic(req)
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})

audioRoute.openapi(audioSfxRoute, async c => {
  const req = c.req.valid('json')
  const rawBody: any = await c.req.json().catch(() => ({}))
  const requestedProvider: string | undefined = typeof rawBody?.provider === 'string' ? rawBody.provider : undefined

  let entry: ReturnType<typeof resolveProvider>['entry']
  let provider: ReturnType<typeof resolveProvider>['provider']
  try {
    ;({ entry, provider } = resolveProvider(req.model, requestedProvider))
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }

  if (entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.audioSfx) throw new ApiError('internal_error', `adapter missing audioSfx`, 500)
    const r = await a.audioSfx(req)
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})
