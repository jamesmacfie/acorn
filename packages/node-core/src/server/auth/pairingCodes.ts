import { randomBytes, timingSafeEqual } from 'node:crypto'

// One-time pairing codes (docs/vNext/protocol.md § Pairing, docs/vNext/security.md § Transport):
// 128-bit, 10-minute window, 5 attempts, single use, owner-initiated on both ends.
//
// In-memory and deliberately not persisted: a code that survived a node restart would be a
// credential sitting on disk for a window the owner believes has closed. Losing an in-flight code
// to a restart is the correct trade — the owner just opens the pairing window again.
//
// This replaces V1's oauthStateStore, which had the same shape for the same reason.

const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 5

export type PairingCodes = {
  // Mints and returns the plaintext code, to be displayed by the node (QR + text).
  issue(): string
  // Consumes the code. True only for the live, unexpired, not-yet-used code within the attempt
  // budget. Every failure mode returns false identically — see the note below.
  consume(code: string): boolean
  // Is a pairing window currently open? Drives the UI, never authorization.
  isOpen(): boolean
  close(): void
}

export function pairingCodes(now: () => number = () => Date.now()): PairingCodes {
  // At most one window at a time: pairing is an explicit owner action at a screen, so a second
  // concurrent code would only widen the guessing surface with no product benefit. Issuing again
  // replaces the previous code, which is also how "regenerate" works.
  let open: { code: Buffer; expiresAt: number; attempts: number } | null = null

  return {
    issue() {
      const code = randomBytes(16) // 128-bit
      open = { code, expiresAt: now() + WINDOW_MS, attempts: 0 }
      return code.toString('base64url')
    },

    // Failures are uniform: no window, expired, attempts exhausted, and wrong code are
    // indistinguishable to the caller (docs/vNext/security.md § Transport: "no oracle for 'right
    // code, wrong something'"). The caller turns this into one generic error.
    consume(candidate) {
      if (!open) return false
      if (now() >= open.expiresAt) {
        open = null
        return false
      }
      // Count the attempt before comparing, so exhausting the budget cannot be avoided by racing.
      open.attempts += 1
      if (open.attempts > MAX_ATTEMPTS) {
        open = null
        return false
      }
      let presented: Buffer
      try {
        presented = Buffer.from(candidate, 'base64url')
      } catch {
        return false
      }
      if (presented.length !== open.code.length || !timingSafeEqual(presented, open.code)) return false
      open = null // single use
      return true
    },

    isOpen() {
      if (open && now() >= open.expiresAt) open = null
      return open !== null
    },

    close() {
      open = null
    },
  }
}
