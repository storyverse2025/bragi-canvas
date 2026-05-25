import { Hono } from 'hono'
import { ImagesGenerationsBody } from '../schemas/images-generations.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const imagesRoute = new Hono()

imagesRoute.post('/images/generations', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = ImagesGenerationsBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'image') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for image`, 400))
    return c.json(body, status)
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
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})
