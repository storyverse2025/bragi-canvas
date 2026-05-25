import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { env } from './env.js'
import { healthRoute } from './routes/health.js'
import { authRoute } from './routes/auth.js'
import { uploadsRoute } from './routes/uploads.js'
import { assetsRoute } from './routes/assets.js'
import { chatRoute } from './routes/chat-completions.js'
import { imagesRoute } from './routes/images-generations.js'
import { videosRoute } from './routes/videos-generations.js'
import { audioRoute } from './routes/audio.js'
import { tasksRoute } from './routes/tasks.js'
import { requireBragiToken } from './auth.js'

const app = new Hono()
app.route('/v1', healthRoute)
app.route('/v1', assetsRoute)
app.use('/v1/auth/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1/auth', authRoute)
app.use('/v1/uploads', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', uploadsRoute)
app.use('/v1/chat/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', chatRoute)
app.use('/v1/images/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', imagesRoute)
app.use('/v1/videos/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', videosRoute)
app.use('/v1/audio/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', audioRoute)
app.use('/v1/tasks/*', requireBragiToken(env.BRAGI_TOKENS))
app.route('/v1', tasksRoute)

serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: info.port }))
})
