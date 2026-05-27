import { describe, it, expect } from 'vitest'
import { OpenAPIHono } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { buildApp } from './helpers.js'

describe('OpenAPI spec', () => {
  function buildDocApp() {
    const app = buildApp() as OpenAPIHono
    app.doc('/v1/openapi.json', {
      openapi: '3.0.0',
      info: { title: 'Storyverse Router', version: '0.1.0' },
    })
    app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
    })
    app.get('/docs', swaggerUI({ url: '/v1/openapi.json' }))
    return app
  }

  it('GET /v1/openapi.json returns valid OpenAPI spec with expected paths', async () => {
    const app = buildDocApp()
    const res = await app.request('/v1/openapi.json')
    expect(res.status).toBe(200)
    const spec = await res.json() as Record<string, unknown>
    expect(spec.openapi).toBe('3.0.0')
    expect((spec.info as Record<string, unknown>).title).toBe('Storyverse Router')
    const paths = spec.paths as Record<string, unknown>
    // Paths are mounted under /v1 prefix
    expect(paths).toHaveProperty('/v1/chat/completions')
    expect(paths).toHaveProperty('/v1/images/generations')
    expect(paths).toHaveProperty('/v1/videos/generations')
    expect(paths).toHaveProperty('/v1/audio/speech')
    expect(paths).toHaveProperty('/v1/audio/music')
    expect(paths).toHaveProperty('/v1/audio/sfx')
    expect(paths).toHaveProperty('/v1/uploads')
    expect(paths).toHaveProperty('/v1/tasks/{provider}/{task_id}')
    expect(paths).toHaveProperty('/v1/health')
    expect(paths).toHaveProperty('/v1/assets/{id}')
    expect(paths).toHaveProperty('/v1/auth/check')
  })

  it('GET /docs returns Swagger UI HTML', async () => {
    const app = buildDocApp()
    const res = await app.request('/docs')
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('swagger')
  })
})
