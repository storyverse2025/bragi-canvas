import { Hono } from 'hono'
import { ChatCompletionsBody } from '../schemas/chat-completions.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const chatRoute = new Hono()

chatRoute.post('/chat/completions', async c => {
  const raw = await c.req.json().catch(() => null)
  const parsed = ChatCompletionsBody.safeParse(raw)
  if (!parsed.success) {
    const { status, body } = toErrorResponse(new ApiError('invalid_request', parsed.error.message, 400))
    return c.json(body, status)
  }
  const req = parsed.data
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'text') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for chat`, 400))
    return c.json(body, status)
  }
  try {
    const a = adapterFor(entry.provider)
    if (!a.chatCompletion) throw new ApiError('internal_error', `adapter ${entry.provider} missing chatCompletion`, 500)
    const r = await a.chatCompletion(req)
    return c.json({
      id: `chatcmpl_${Date.now().toString(36)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.model,
      choices: [{ index: 0, message: { role: 'assistant', content: r.outputs[0].text ?? '' }, finish_reason: 'stop' }],
    })
  } catch (e) {
    if (e instanceof ApiError) {
      const { status, body } = toErrorResponse(e)
      return c.json(body, status)
    }
    throw e
  }
})
