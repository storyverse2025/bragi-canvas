import { serve } from '@hono/node-server'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { cors } from 'hono/cors'
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
import { cleanupExpiredAssets } from './assets.js'

const app = new OpenAPIHono()
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
  exposeHeaders: ['Content-Type', 'Content-Length'],
  maxAge: 86400,
  credentials: false,
}))
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

app.doc('/v1/openapi.json', {
  openapi: '3.0.0',
  info: { title: 'Storyverse Router', version: '0.1.0' },
})
app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
})
app.get('/docs', swaggerUI({ url: '/v1/openapi.json' }))

serve({ fetch: app.fetch, port: env.PORT }, info => {
  console.log(JSON.stringify({ level: 'info', msg: 'listening', port: info.port }))

  const tmpDir = env.ASSET_TMP_DIR
  const ttlSec = env.ASSET_TTL_SECONDS
  const CLEANUP_INTERVAL_MS = 10 * 60 * 1000 // 10 minutes

  // Run once at startup
  cleanupExpiredAssets(tmpDir, ttlSec).then(n => {
    if (n > 0) console.log(JSON.stringify({ level: 'info', msg: 'startup cleanup', removed: n }))
  }).catch(() => {})

  // Schedule periodic cleanup
  setInterval(() => {
    cleanupExpiredAssets(tmpDir, ttlSec).then(n => {
      if (n > 0) console.log(JSON.stringify({ level: 'info', msg: 'periodic cleanup', removed: n }))
    }).catch(() => {})
  }, CLEANUP_INTERVAL_MS).unref()
})
