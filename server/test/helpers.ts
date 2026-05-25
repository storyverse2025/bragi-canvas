import { Hono } from 'hono'
import { healthRoute } from '../src/routes/health.js'
import { authRoute } from '../src/routes/auth.js'
import { uploadsRoute } from '../src/routes/uploads.js'
import { assetsRoute } from '../src/routes/assets.js'
import { requireBragiToken } from '../src/auth.js'

const TEST_TOKENS = new Set(['svsk-test-1', 'svsk-test-2'])

export function buildApp(): Hono {
  const app = new Hono()
  app.route('/v1', healthRoute)
  app.route('/v1', assetsRoute)                          // BEFORE auth — sig is the auth
  app.use('/v1/auth/*', requireBragiToken(TEST_TOKENS))
  app.route('/v1/auth', authRoute)
  app.use('/v1/uploads', requireBragiToken(TEST_TOKENS))
  app.route('/v1', uploadsRoute)
  return app
}
