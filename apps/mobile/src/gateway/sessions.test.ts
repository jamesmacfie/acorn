import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { sessionStore } from './sessions'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'
let dir: string

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'acorn-gateway-sessions-')), 'sessions')
})
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }))

it('keeps a hash of the session ID, never the ID', () => {
  const sessionId = sessionStore(dir).create(IPHONE)
  const [file] = readdirSync(dir)
  expect(file).toMatch(/^[0-9a-f]{64}\.json$/)
  expect(file).not.toContain(sessionId)
  expect(readFileSync(join(dir, file!), 'utf8')).not.toContain(sessionId)
})

it('lists a session with a label from the user agent', () => {
  const store = sessionStore(dir)
  store.create(IPHONE)
  expect(store.list()).toEqual([
    {
      id: expect.stringMatching(/^[0-9a-f]{12}$/),
      label: 'iPhone; CPU iPhone OS 18_0 like Mac OS X',
      createdAt: expect.any(Number),
      lastUsedAt: expect.any(Number),
    },
  ])
})

it('marks a session used and refuses an unknown one', () => {
  const store = sessionStore(dir)
  const sessionId = store.create(IPHONE)
  expect(store.use(sessionId)).toMatch(/^[0-9a-f]{64}$/)
  expect(store.use('not-a-session')).toBeNull()
})

it('ends a session revoked from another process', () => {
  const store = sessionStore(dir)
  const sessionId = store.create(IPHONE)
  const hash = store.use(sessionId)!
  const elsewhere = sessionStore(dir)
  expect(elsewhere.revoke(elsewhere.list()[0]!.id)).toBe(true)
  expect(store.isLive(hash)).toBe(false)
  expect(store.use(sessionId)).toBeNull()
  expect(store.list()).toEqual([])
})

it('revokes nothing for an ID no session has', () => {
  const store = sessionStore(dir)
  store.create(IPHONE)
  expect(store.revoke('000000000000')).toBe(false)
  expect(store.revoke('../../etc')).toBe(false)
  expect(store.list()).toHaveLength(1)
})
