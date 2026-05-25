export type ErrorCode =
  | 'invalid_token'
  | 'unknown_model'
  | 'invalid_request'
  | 'provider_invalid_request'
  | 'provider_unavailable'
  | 'internal_error'

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly httpStatus: number,
    public readonly providerRaw?: unknown,
  ) {
    super(message)
  }
}

export function toErrorResponse(e: ApiError): {
  status: number
  body: { status: 'failed'; error: { code: ErrorCode; message: string; provider_raw?: unknown } }
} {
  return {
    status: e.httpStatus,
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
