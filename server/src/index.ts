import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { healthRoute } from './routes/health.js'

const app = new Hono()
app.route('/v1', healthRoute)

serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: info.port }))
})
