import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { PairingAsk, PairingDecision, PairingRequest } from '@acorn/protocol/node.ts'
import { fingerprintWords } from '@acorn/protocol/fingerprintWords.ts'

// Pairing by approval (docs/api-reference/transport.md § Pairing by approval). A client on this
// computer asks for a device token, the owner allows or denies it from a client that is already
// paired, and the asker collects the token with the secret only it was given.
//
// One request at a time, like one code at a time (pairingCodes.ts). A new ask replaces the old one, so
// a person who quits and reruns `acorn` isn't locked out by their own first attempt. The phrase is
// what lets the owner tell their own request from one something else raced in: the asker prints it,
// and the dialog shows it.
//
// In memory on purpose. A restart drops the request, and the asker gets the same refusal as a denial.

export const PAIRING_REQUEST_MS = 2 * 60_000
const PHRASE_WORDS = 3

export type PairingRequests = {
  ask(deviceName: string): PairingAsk
  // The request waiting for an answer, or null once it is answered, expired, or replaced.
  pending(): PairingRequest | null
  // False when `id` isn't the request waiting for an answer.
  decide(id: string, decision: PairingDecision['decision']): boolean
  // An allowed claim spends the request. Every kind of refusal looks the same to the caller.
  claim(secret: string): { status: 'pending' } | { status: 'refused' } | { status: 'allowed'; deviceName: string }
}

export function pairingRequests(now: () => number = () => Date.now()): PairingRequests {
  let held: {
    id: string
    deviceName: string
    phrase: string
    secret: Buffer
    expiresAt: number
    allowed: boolean
  } | null = null

  const live = () => {
    if (held && now() >= held.expiresAt) held = null
    return held
  }

  return {
    ask(deviceName) {
      const secret = randomBytes(32)
      // Words from random bytes, through the same list the certificate words use.
      const phrase = fingerprintWords(randomBytes(32).toString('hex'), PHRASE_WORDS)!.join(' ')
      held = { id: randomUUID(), deviceName, phrase, secret, expiresAt: now() + PAIRING_REQUEST_MS, allowed: false }
      return { secret: secret.toString('base64url'), phrase, expiresInMs: PAIRING_REQUEST_MS }
    },

    pending() {
      const request = live()
      if (!request || request.allowed) return null
      const { id, deviceName, phrase, expiresAt } = request
      return { id, deviceName, phrase, expiresAt }
    },

    decide(id, decision) {
      const request = live()
      if (!request || request.allowed || request.id !== id) return false
      if (decision === 'allow') request.allowed = true
      else held = null
      return true
    },

    claim(candidate) {
      const request = live()
      if (!request) return { status: 'refused' }
      const presented = Buffer.from(candidate, 'base64url')
      if (presented.length !== request.secret.length || !timingSafeEqual(presented, request.secret))
        return { status: 'refused' }
      if (!request.allowed) return { status: 'pending' }
      held = null // single use
      return { status: 'allowed', deviceName: request.deviceName }
    },
  }
}
