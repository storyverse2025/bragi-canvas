import type { MiddlewareHandler } from 'hono'
import { ApiError, toErrorResponse } from './errors.js'

/**
 * Mask a bragi token for safe echoing back to the caller (e.g. /v1/auth/check).
 * Tokens are shaped `svsk-<label>-<secret>`; we reveal the human-readable prefix
 * up to and including the final `-` (so the caller can still tell WHICH token
 * they sent) and replace the high-entropy secret suffix with `****`. The secret
 * is never returned. Tokens without a usable `-` fall back to a 4-char prefix.
 */
export function maskBragiToken(token: string): string {
  const lastDash = token.lastIndexOf('-')
  if (lastDash <= 0) return `${token.slice(0, 4)}****`
  return `${token.slice(0, lastDash + 1)}****`
}

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
