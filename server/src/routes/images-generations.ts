import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { ImagesGenerationsBody } from '../schemas/images-generations.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

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
  summary: 'Generate images',
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
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'image') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for image`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.imageGeneration) throw new ApiError('internal_error', `adapter missing imageGeneration`, 500)
    const r = await a.imageGeneration(req)
    if (r.status === 'queued') {
      return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
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
