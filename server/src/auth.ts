import type { MiddlewareHandler } from 'hono'
import { ApiError, toErrorResponse } from './errors.js'

/**
 * Mask a bragi token for safe echoing back to the caller (e.g. /v1/auth/check).
 * Tokens are shaped `svsk-<label>-<secret>`; we reveal the human-readable prefix
 * up to and including the label's trailing `-` (so the caller can still tell
 * WHICH token they sent) and replace the secret with `****`.
 *
 * The secret itself may contain `-` (the token regex is `svsk-[A-Za-z0-9_-]+`),
 * so we split on the FIRST `-` after the `svsk-` prefix — the label/secret
 * boundary — NOT the last. Splitting on the last `-` would leak every secret
 * segment except the final one. The secret is never returned. A token with no
 * separator after the prefix falls back to masking everything after `svsk-`.
 */
export function maskBragiToken(token: string): string {
  const sep = token.indexOf('-', 'svsk-'.length)
  if (sep <= 0) return `${token.slice(0, 5)}****`
  return `${token.slice(0, sep + 1)}****`
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
