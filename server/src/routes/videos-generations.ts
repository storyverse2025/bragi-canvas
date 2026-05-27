import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { VideosGenerationsBody } from '../schemas/videos-generations.js'
import { resolveProvider } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const videosRoute = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = toErrorResponse(new ApiError('invalid_request', result.error.message, 400))
      return c.json(body, status)
    }
  },
})

const videosGenerationsRoute = createRoute({
  method: 'post',
  path: '/videos/generations',
  tags: ['videos'],
  summary: 'Generate a video (async). Optional top-level "provider" field overrides default routing.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: VideosGenerationsBody } },
      required: true,
    },
  },
  responses: {
    202: {
      description: 'Async video task queued',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Validation error / missing asset / unknown model',
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

videosRoute.openapi(videosGenerationsRoute, async c => {
  const req = c.req.valid('json')
  // Read optional provider override from raw body (Zod strips unknown keys)
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

  if (entry.capability !== 'video') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for video`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.videoGeneration) throw new ApiError('internal_error', `adapter missing videoGeneration`, 500)
    const r = await a.videoGeneration(req)
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
