import { beforeEach, describe, expect, it } from 'vitest'
import { pairingCodes, type PairingCodes } from './pairingCodes'

let codes: PairingCodes
let clock: number
const WINDOW_MS = 10 * 60_000

beforeEach(() => {
  clock = 1_700_000_000_000
  codes = pairingCodes(() => clock)
})

describe('pairing codes', () => {
  it('accepts the live code exactly once', () => {
    const code = codes.issue()
    expect(codes.isOpen()).toBe(true)
    expect(codes.consume(code)).toBe(true)
    expect(codes.consume(code)).toBe(false) // single use
    expect(codes.isOpen()).toBe(false)
  })

  it('mints a 128-bit code', () => {
    expect(Buffer.from(codes.issue(), 'base64url')).toHaveLength(16)
  })

  it('mints a different code each time', () => {
    const seen = new Set(Array.from({ length: 20 }, () => codes.issue()))
    expect(seen.size).toBe(20)
  })

  it('expires after the 10-minute window', () => {
    const code = codes.issue()
    clock += WINDOW_MS - 1
    expect(codes.isOpen()).toBe(true)
    clock += 1
    expect(codes.isOpen()).toBe(false)
    expect(codes.consume(code)).toBe(false)
  })

  it('exhausts after 5 attempts and closes the window', () => {
    const code = codes.issue()
    for (let i = 0; i < 5; i++) expect(codes.consume('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false)
    // The budget is spent, so even the correct code no longer works — the owner must reissue.
    expect(codes.consume(code)).toBe(false)
    expect(codes.isOpen()).toBe(false)
  })

  // docs/vNext/security.md § Transport: "Failures are uniform — no oracle for 'right code, wrong
  // something'". Every one of these must be the same `false` to the caller.
  it('fails identically for no window, expired, wrong and malformed', () => {
    expect(codes.consume('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false) // no window open

    codes.issue()
    expect(codes.consume('AAAAAAAAAAAAAAAAAAAAAA')).toBe(false) // wrong code
    expect(codes.consume('!!!not base64url!!!')).toBe(false) // malformed
    expect(codes.consume('QUJD')).toBe(false) // right encoding, wrong length

    const expiring = codes.issue()
    clock += WINDOW_MS
    expect(codes.consume(expiring)).toBe(false) // expired
  })

  it('replaces the previous code when reissued, so only one window is ever open', () => {
    const first = codes.issue()
    const second = codes.issue()
    expect(codes.consume(first)).toBe(false)
    expect(codes.consume(second)).toBe(true)
  })

  it('closes on request', () => {
    const code = codes.issue()
    codes.close()
    expect(codes.isOpen()).toBe(false)
    expect(codes.consume(code)).toBe(false)
  })
})
