import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { adapterFor } from '../adapters/index.js'
import { decodeTaskId } from '../adapters/task-id.js'
import { ApiError, toErrorResponse } from '../errors.js'
import type { Provider } from '../registry.js'

// Providers that have async task workflows (implement taskStatus())
// Note: xai now supports async via grok-video (POST /v1/videos/generations, poll /v1/videos/{id})
// Note: tokenrouter now supports async via seedance (POST /v1/videos, poll /v1/videos/{id})
const ASYNC_PROVIDERS = new Set<Provider>([
  'gemini',       // Veo video
  'byteplus',     // Seedance video (fallback)
  'fal',          // Kling, ElevenLabs, nano-banana
  // luma is now sync image (luma-uni-1 moved video→image in V2); no async tasks.
  'legnext',      // Midjourney (returns 501 in V1)
  'apimart',      // gpt-image-2
  'xai',          // grok-video (native video API)
  'tokenrouter',  // seedance-2.0/-fast via OpenAI Videos API
])

export const tasksRoute = new OpenAPIHono()

const tasksGetRoute = createRoute({
  method: 'get',
  path: '/tasks/{provider}/{task_id}',
  tags: ['tasks'],
  summary: 'Poll async task status',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      provider: z.string().openapi({ description: 'Provider name (e.g. fal, luma, byteplus)' }),
      task_id: z.string().openapi({ description: 'Provider task ID (base64url-encoded opaque string as returned by the generation endpoint)' }),
    }),
  },
  responses: {
    200: {
      description: 'Task status. status field is one of: running | succeeded | failed. Note: a provider-side task failure is reported as HTTP 200 with status:"failed" (not an HTTP error), since the poll itself succeeded.',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Unknown provider or sync-only provider (no task polling)',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
    503: {
      description: 'Provider transport failure while polling',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

tasksRoute.openapi(tasksGetRoute, async c => {
  const provider = c.req.param('provider') as Provider
  const encodedTaskId = c.req.param('task_id')
  if (!ASYNC_PROVIDERS.has(provider)) {
    const knownSyncOnly = new Set(['openai'])
    const message = knownSyncOnly.has(provider)
      ? `provider ${provider} does not support task polling (sync-only)`
      : `unknown provider ${provider}`
    const { status, body } = toErrorResponse(new ApiError('invalid_request', message, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  // Decode the base64url task ID back to the raw provider value
  let rawTaskId: string
  try {
    rawTaskId = decodeTaskId(encodedTaskId)
  } catch {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', 'invalid task_id (expected base64url)', 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.taskStatus) throw new ApiError('invalid_request', `provider ${provider} does not support task polling`, 400)
    const r = await a.taskStatus(rawTaskId)
    return c.json(r)
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})
