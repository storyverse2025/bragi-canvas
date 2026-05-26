import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'
import { ChatCompletionsBody } from '../schemas/chat-completions.js'
import { lookupModel } from '../registry.js'
import { adapterFor } from '../adapters/index.js'
import { ApiError, toErrorResponse } from '../errors.js'

export const chatRoute = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const { status, body } = toErrorResponse(new ApiError('invalid_request', result.error.message, 400))
      return c.json(body, status)
    }
  },
})

const chatCompletionsRoute = createRoute({
  method: 'post',
  path: '/chat/completions',
  tags: ['chat'],
  summary: 'Generate a chat completion (OpenAI-compatible)',
  security: [{ bearerAuth: [] }],
  request: {
    body: {
      content: { 'application/json': { schema: ChatCompletionsBody } },
      required: true,
    },
  },
  responses: {
    200: {
      description: 'OpenAI ChatCompletion',
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

chatRoute.openapi(chatCompletionsRoute, async c => {
  // Re-parse for type safety (openapi already validated, but req.json() for handler convenience)
  const req = c.req.valid('json')
  const entry = lookupModel(req.model)
  if (!entry || entry.capability !== 'text') {
    const { status, body } = toErrorResponse(new ApiError('unknown_model', `model ${req.model} unsupported for chat`, 400))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return c.json(body, status) as any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return c.json(body, status) as any
    }
    throw e
  }
})
