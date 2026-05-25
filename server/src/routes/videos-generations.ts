import { Hono } from 'hono'
import { VideosGenerationsBody } from '../schemas/videos-generations.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const videosRoute = new Hono()

videosRoute.post('/videos/generations', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = VideosGenerationsBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
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
