import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { healthRoute } from './routes/health.js'
import { authRoute } from './routes/auth.js'
import { uploadsRoute } from './routes/uploads.js'
import { assetsRoute } from './routes/assets.js'
import { requireBragiToken } from './auth.js'

const app = new Hono()
app.route('/v1', healthRoute)
app.route('/v1', assetsRoute)
app.use('/v1/auth/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1/auth', authRoute)
app.use('/v1/uploads', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', uploadsRoute)

serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: info.port }))
})
