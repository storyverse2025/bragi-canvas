import { OpenAPIHono } from '@hono/zod-openapi'
import { healthRoute } from '../src/routes/health.js'
import { authRoute } from '../src/routes/auth.js'
import { uploadsRoute } from '../src/routes/uploads.js'
import { assetsRoute } from '../src/routes/assets.js'
import { chatRoute } from '../src/routes/chat-completions.js'
import { imagesRoute } from '../src/routes/images-generations.js'
import { videosRoute } from '../src/routes/videos-generations.js'
import { audioRoute } from '../src/routes/audio.js'
import { tasksRoute } from '../src/routes/tasks.js'
import { requireBragiToken } from '../src/auth.js'

const TEST_TOKENS = new Set(['svsk-test-1', 'svsk-test-2'])

export function buildApp(): OpenAPIHono {
  const app = new OpenAPIHono()
  app.route('/v1', healthRoute)
  app.route('/v1', assetsRoute)                          // BEFORE auth — sig is the auth
  app.use('/v1/auth/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1/auth', authRoute)
  app.use('/v1/uploads', requireBragiToken(TEST_TOKENS))
  app.route('/v1', uploadsRoute)
  app.use('/v1/chat/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1', chatRoute)
  app.use('/v1/images/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1', imagesRoute)
  app.use('/v1/videos/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1', videosRoute)
  app.use('/v1/audio/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1', audioRoute)
  app.use('/v1/tasks/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1', tasksRoute)
  return app
}
