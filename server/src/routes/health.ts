import { OpenAPIHono, createRoute } from '@hono/zod-openapi'
import { z } from 'zod'

const start = Date.now()
export const healthRoute = new OpenAPIHono()

const healthRoute_ = createRoute({
  method: 'get',
  path: '/health',
  tags: ['system'],
  summary: 'Health check',
  security: [],
  responses: {
    200: {
      description: 'Service is healthy',
      content: { 'application/json': { schema: z.any() } },
    },
  },
})

healthRoute.openapi(healthRoute_, c => c.json({
  ok: true,
  version: '0.1.0',
  uptime_sec: Math.floor((Date.now() - start) / 1000),
}))
