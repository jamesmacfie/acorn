import { beforeEach, expect, it } from 'vitest'
import { PAIRING_REQUEST_MS, pairingRequests, type PairingRequests } from './pairingRequests'

let requests: PairingRequests
let clock: number

beforeEach(() => {
  clock = 1_700_000_000_000
  requests = pairingRequests(() => clock)
})

it('hands the token over once, after the owner allows it', () => {
  const { secret, phrase } = requests.ask('acorn on laptop')
  const pending = requests.pending()!
  expect(pending).toMatchObject({ deviceName: 'acorn on laptop', phrase })
  expect(phrase.split(' ')).toHaveLength(3)
  expect(requests.claim(secret)).toEqual({ status: 'pending' })
  expect(requests.decide(pending.id, 'allow')).toBe(true)
  // Answered, so the owner's dialog has nothing left to show.
  expect(requests.pending()).toBeNull()
  expect(requests.claim(secret)).toEqual({ status: 'allowed', deviceName: 'acorn on laptop' })
  expect(requests.claim(secret)).toEqual({ status: 'refused' })
})

it('refuses a denied, expired, or replaced request, and a wrong secret', () => {
  const denied = requests.ask('a')
  requests.decide(requests.pending()!.id, 'deny')
  expect(requests.claim(denied.secret)).toEqual({ status: 'refused' })

  const expired = requests.ask('b')
  clock += PAIRING_REQUEST_MS
  expect(requests.pending()).toBeNull()
  expect(requests.claim(expired.secret)).toEqual({ status: 'refused' })

  const replaced = requests.ask('c')
  const first = requests.pending()!.id
  const latest = requests.ask('d')
  expect(requests.decide(first, 'allow')).toBe(false)
  expect(requests.claim(replaced.secret)).toEqual({ status: 'refused' })
  expect(requests.claim('not-the-secret')).toEqual({ status: 'refused' })
  // A wrong secret leaves the real request waiting.
  expect(requests.claim(latest.secret)).toEqual({ status: 'pending' })
})
