import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { VideosGenerationsBody } from '../schemas/videos-generations.js'
import { lookupModel } from '../registry.js'
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
  summary: 'Generate a video (async)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: VideosGenerationsBody } },
      required: true,
    },
  },
  responses: {
    202: {
      description: 'Video generation queued',
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

videosRoute.openapi(videosGenerationsRoute, async c => {
  const req = c.req.valid('json')
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'video') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for video`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.videoGeneration) throw new ApiError('internal_error', `adapter missing videoGeneration`, 500)
    const r = await a.videoGeneration(req)
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})
