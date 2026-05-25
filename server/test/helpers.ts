import { Hono } from 'hono'
import { healthRoute } from '../src/routes/health.js'

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/v1', healthRoute)
  return app
}
