import { describe, it, expect } from 'vitest'
import { ApiError, toErrorResponse } from '../src/errors.js'

describe('errors', () => {
  it('serializes ApiError to JSON', () => {
    const e = new ApiError('invalid_token', 'bad', 401)
    const { status, body } = toErrorResponse(e)
    expect(status).toBe(401)
    expect(body).toEqual({
      status: 'failed',
      error: { code: 'invalid_token', message: 'bad' },
    })
  })

  it('wraps provider_raw when present', () => {
    const e = new ApiError('provider_invalid_request', 'no', 422, { upstream: 'x' })
    const { body } = toErrorResponse(e)
    expect(body.error.provider_raw).toEqual({ upstream: 'x' })
  })
})
