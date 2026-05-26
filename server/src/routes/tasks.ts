import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'
import type { Provider } from '../registry.js'

const VALID_PROVIDERS = new Set<Provider>([
  'openai', 'gemini', 'byteplus', 'fal', 'luma', 'xai', 'legnext', 'tokenrouter', 'apimart',
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
      task_id: z.string().openapi({ description: 'Provider task ID' }),
    }),
  },
  responses: {
    200: {
      description: 'Task status',
      content: { 'application/json': { schema: z.any() } },
    },
    400: {
      description: 'Invalid provider',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

tasksRoute.openapi(tasksGetRoute, async c => {
  const provider = c.req.param('provider') as Provider
  const taskId = c.req.param('task_id')
  if (!VALID_PROVIDERS.has(provider)) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', `unknown provider ${provider}`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
  }
  try {
    const a = adapterFor(provider)
    if (!a.taskStatus) throw new ApiError('internal_error', `${provider} no taskStatus`, 500)
    const r = await a.taskStatus(taskId)
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
