import type { MiddlewareHandler } from 'hono'
import { ApiError, toErrorResponse } from './errors.js'

export function requireBragiToken(allowlist: ReadonlySet<string>): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization') ?? ''
    const m = header.match(/^Bearer\s+(svsk-[A-Za-z0-9_-]+)$/)
    const token = m?.[1]
    if (!token || !allowlist.has(token)) {
      const { status, body } = toErrorResponse(new ApiError('invalid_token', 'Token not recognized', 401))
      return c.json(body, status)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(c as any).set('bragiToken', token)
    await next()
  }
}
