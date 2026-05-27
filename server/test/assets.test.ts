import { describe, it, expect } from 'vitest'
import { signAssetUrl, verifyAssetSig } from '../src/assets.js'

const SECRET = '0123456789abcdef0123456789abcdef'

describe('asset signing', () => {
  it('signs and verifies a valid URL', () => {
    const expires = Math.floor(Date.now() / 1000) + 60
    const sig = signAssetUrl('ast_abc', expires, SECRET)
    expect(verifyAssetSig('ast_abc', expires, sig, SECRET)).toBe(true)
  })

  it('rejects tampered asset id', () => {
    const expires = Math.floor(Date.now() / 1000) + 60
    const sig = signAssetUrl('ast_abc', expires, SECRET)
    expect(verifyAssetSig('ast_xyz', expires, sig, SECRET)).toBe(false)
  })

  it('rejects expired url', () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const sig = signAssetUrl('ast_abc', past, SECRET)
    expect(verifyAssetSig('ast_abc', past, sig, SECRET)).toBe(false)
  })
})
