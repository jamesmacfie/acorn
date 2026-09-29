import { describe, expect, it } from 'vitest'
import { FINGERPRINT_WORD_COUNT, fingerprintPhrase, fingerprintWords } from './fingerprintWords'

// The comparison is the security of pairing (docs/api-reference.md § Pairing): two 64-character hex
// strings differing in the middle look identical to a person, which is exactly the substitution an
// attacker wants. Six words make that comparison practical.

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const B = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f91'

describe('the word list', () => {
  it('is exactly 256 entries, so a word is one byte', () => {
    // The arithmetic behind "six words": 256 entries is 8 bits each, so six carry 48. That is the same
    // strength as comparing twelve hex characters. A different size silently changes every
    // fingerprint's phrase, so this is pinned rather than left to the array literal.
    expect(FINGERPRINT_WORD_COUNT).toBe(256)
  })
})

describe('fingerprintWords', () => {
  it('is deterministic and reads the leading bytes', () => {
    expect(fingerprintWords(A)).toEqual(fingerprintWords(A))
    expect(fingerprintWords(A)).toHaveLength(6)
    expect(fingerprintPhrase(A)).toBe(fingerprintWords(A)!.join(' '))
  })

  it('ignores separators and case, so the same certificate always reads the same', () => {
    // The node prints bare lowercase hex; a value pasted from elsewhere may be colon-separated or upper case.
    // Two spellings of one certificate producing two phrases would make the check useless.
    expect(fingerprintWords('A1:B2:C3:D4:E5:F6:07:18')).toEqual(fingerprintWords('a1b2c3d4e5f60718'))
  })

  it('distinguishes certificates that differ in the LEADING bytes', () => {
    expect(fingerprintPhrase('b1b2c3d4e5f60718293a4b5c')).not.toBe(fingerprintPhrase('a1b2c3d4e5f60718293a4b5c'))
  })

  it('does NOT distinguish a change in the trailing bytes — which is why the hex is still shown', () => {
    // Six words cover the first six bytes. Recorded as a property rather than discovered later: the phrase is
    // the check a person can make, and the raw hex beside it is the exact comparison. Dropping the hex would
    // remove the only precise option.
    expect(fingerprintPhrase(A)).toBe(fingerprintPhrase(B))
    expect(A).not.toBe(B)
  })

  it('is null rather than a partial phrase for a value too short to be a fingerprint', () => {
    // A truncated comparison string is worse than none, because it still looks checkable.
    expect(fingerprintWords('a1b2')).toBeNull()
    expect(fingerprintWords('')).toBeNull()
    expect(fingerprintWords(undefined)).toBeNull()
    expect(fingerprintWords(null)).toBeNull()
    expect(fingerprintPhrase('not a fingerprint')).toBeNull()
  })
})
