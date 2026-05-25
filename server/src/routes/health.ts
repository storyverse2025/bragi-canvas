import { Hono } from 'hono'

const start = Date.now()
export const healthRoute = new Hono()

healthRoute.get('/health', c => c.json({
  ok: true,
  version: '0.1.0',
  uptime_sec: Math.floor((Date.now() - start) / 1000),
}))
