import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'

export const authRoute = new OpenAPIHono()

const authCheckRoute = createRoute({
  method: 'post',
  path: '/check',
  tags: ['auth'],
  summary: 'Verify bearer token',
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Token is valid',
      content: { 'application/json': { schema: z.any() } },
    },
    401: {
      description: 'Invalid or missing svsk- token',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

authRoute.openapi(authCheckRoute, c => c.json({ ok: true }))
