import { Hono } from 'hono'
import { AudioSpeechBody } from '../schemas/audio-speech.js'
import { AudioMusicBody } from '../schemas/audio-music.js'
import { AudioSfxBody } from '../schemas/audio-sfx.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const audioRoute = new Hono()

audioRoute.post('/audio/speech', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = AudioSpeechBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.audioSpeech) throw new ApiError('internal_error', `adapter missing audioSpeech`, 500)
    const r = await a.audioSpeech(req)
    if ('bytes' in r) {
      return new Response(new Uint8Array(r.bytes), { headers: { 'Content-Type': r.mimeType } })
    }
    // AsyncResult
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})

audioRoute.post('/audio/music', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = AudioMusicBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.audioMusic) throw new ApiError('internal_error', `adapter missing audioMusic`, 500)
    const r = await a.audioMusic(req)
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})

audioRoute.post('/audio/sfx', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = AudioSfxBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'audio') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for audio`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.audioSfx) throw new ApiError('internal_error', `adapter missing audioSfx`, 500)
    const r = await a.audioSfx(req)
    return c.json({ task_id: r.provider_task_id, provider: r.provider, poll_after_ms: r.poll_after_ms }, 202)
  } catch (e) {
    if (e instanceof ApiError) { const { status, body } = toErrorResponse(e); return c.json(body, status) }
    throw e
  }
})
