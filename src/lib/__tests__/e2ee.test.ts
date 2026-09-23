import { describe, it, expect } from 'vitest'
import { isEncryptedField } from '../e2ee'

describe('isEncryptedField', () => {
  it('recognises the vault field format', () => {
    expect(isEncryptedField('e2ee:aXY=:Y3Q=')).toBe(true)
  })

  it('does not mistake a plaintext code for ciphertext', () => {
    // A false positive renders "••••••" over a code the user can actually read.
    expect(isEncryptedField('7290001234567')).toBe(false)
    expect(isEncryptedField('BM-8843-QZ7P')).toBe(false)
    expect(isEncryptedField('my e2ee code')).toBe(false)
  })

  it('handles null and empty values', () => {
    // A false negative is worse: ciphertext would be saved as if it were plaintext.
    expect(isEncryptedField(null)).toBe(false)
    expect(isEncryptedField(undefined)).toBe(false)
    expect(isEncryptedField('')).toBe(false)
  })
})
