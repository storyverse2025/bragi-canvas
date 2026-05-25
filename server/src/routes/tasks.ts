import { Hono } from 'hono'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'
import type { Provider } from '../registry.js'

const VALID_PROVIDERS = new Set<Provider>([
  'openai', 'gemini', 'byteplus', 'fal', 'luma', 'xai', 'legnext', 'tokenrouter',
])

export const tasksRoute = new Hono()

tasksRoute.get('/tasks/:provider/:task_id', async c => {
  const provider = c.req.param('provider') as Provider
  const taskId = c.req.param('task_id')
  if (!VALID_PROVIDERS.has(provider)) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', `unknown provider ${provider}`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(provider)
    if (!a.taskStatus) throw new ApiError('internal_error', `${provider} no taskStatus`, 500)
    const r = await a.taskStatus(taskId)
    return c.json(r)
  } catch (e) {
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})
