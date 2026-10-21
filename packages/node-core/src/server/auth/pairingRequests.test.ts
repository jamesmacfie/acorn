import { beforeEach, expect, it } from 'vitest'
import { PAIRING_REQUEST_MS, pairingRequests, type PairingRequests } from './pairingRequests'

let requests: PairingRequests
let clock: number

beforeEach(() => {
  clock = 1_700_000_000_000
  requests = pairingRequests(() => clock)
})

it('hands the token over once, after the owner allows it', () => {
  const { secret, phrase } = requests.ask('acorn on laptop')!
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
  const denied = requests.ask('a')!
  requests.decide(requests.pending()!.id, 'deny')
  expect(requests.claim(denied.secret)).toEqual({ status: 'refused' })

  const expired = requests.ask('b')!
  clock += PAIRING_REQUEST_MS
  expect(requests.pending()).toBeNull()
  expect(requests.claim(expired.secret)).toEqual({ status: 'refused' })

  const answered = requests.ask('c')!
  requests.decide(requests.pending()!.id, 'allow')
  const afterAnswer = requests.ask('d')!
  expect(requests.claim(answered.secret)).toEqual({ status: 'refused' })
  expect(requests.claim('not-the-secret')).toEqual({ status: 'refused' })
  // A wrong secret leaves the real request waiting.
  expect(requests.claim(afterAnswer.secret)).toEqual({ status: 'pending' })
})

it('cancels both when a second ask overlaps, then starts clean', () => {
  const first = requests.ask('owner')!
  const firstId = requests.pending()!.id
  expect(requests.ask('agent')).toBeNull()
  expect(requests.pending()).toBeNull()
  expect(requests.decide(firstId, 'allow')).toBe(false)
  expect(requests.claim(first.secret)).toEqual({ status: 'refused' })

  const third = requests.ask('owner again')!
  expect(requests.claim(third.secret)).toEqual({ status: 'pending' })
})
