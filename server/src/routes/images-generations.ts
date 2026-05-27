import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { ImagesGenerationsBody } from '../schemas/images-generations.js'
import { resolveProvider } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { encodeTaskId } from '../adapters/task-id.js'
import { ApiError, toErrorResponse } from '../errors.js'
import { env } from '../env.js'

export const imagesRoute = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = toErrorResponse(new ApiError('invalid_request', result.error.message, 400))
      return c.json(body, status)
    }
  },
})

const imagesGenerationsRoute = createRoute({
  method: 'post',
  path: '/images/generations',
  tags: ['images'],
  summary: 'Generate images. Optional top-level "provider" field overrides default routing.',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: ImagesGenerationsBody } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'Image generation result',
      content: { 'application/json': { schema: z.any() } },
    },
    202: {
      description: 'Image generation queued (async)',
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
  },
})

imagesRoute.openapi(imagesGenerationsRoute, async c => {
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

  if (entry.capability !== 'image') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for image`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.imageGeneration) throw new ApiError('internal_error', `adapter missing imageGeneration`, 500)
    const r = await a.imageGeneration(req)
    if (r.status === 'queued') {
      const encodedTaskId = encodeTaskId(r.provider_task_id)
      const pollUrl = `${env.ROUTER_PUBLIC_URL}/v1/tasks/${r.provider}/${encodedTaskId}`
      return c.json({ task_id: encodedTaskId, provider: r.provider, poll_after_ms: r.poll_after_ms, poll_url: pollUrl }, 202)
    }
    return c.json({
      created: Math.floor(Date.now() / 1000),
      data: r.outputs.map(o => ({ url: o.url })),
    })
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})
