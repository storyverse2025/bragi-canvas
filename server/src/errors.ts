import type { ContentfulStatusCode } from 'hono/utils/http-status'

export type ErrorCode =
  | 'invalid_token'
  | 'unknown_model'
  | 'invalid_request'
  | 'provider_invalid_request'
  | 'provider_unavailable'
  | 'internal_error'

/** Narrow union of HTTP status codes actually used by ApiError callsites. */
export type HttpStatus = 400 | 401 | 422 | 500 | 501 | 502 | 503

/**
 * Map an arbitrary HTTP status code from a provider response to the nearest
 * HttpStatus value we support in ApiError. Keeps adapter code clean — callers
 * can pass `res.status` without casting.
 */
export function toHttpStatus(code: number): HttpStatus {
  if (code === 429) return 503
  if (code === 400 || code === 401 || code === 422) return code
  if (code === 501) return 501
  if (code === 502) return 502
  if (code === 503) return 503
  if (code >= 500) return 500
  return 400
}

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: HttpStatus,
    public readonly providerRaw?: unknown,
  ) {
    super(message)
  }
}

export function toErrorResponse(e: ApiError): {
  status: ContentfulStatusCode
  body: { status: 'failed'; error: { code: ErrorCode; message: string; provider_raw?: unknown } }
} {
  return {
    status: e.httpStatus as ContentfulStatusCode,
    body: {
      status: 'failed',
      error: {
        code: e.code,
        message: e.message,
        ...(e.providerRaw !== undefined ? { provider_raw: e.providerRaw } : {}),
      },
    },
  }
}
