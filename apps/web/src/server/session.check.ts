// Self-check for the session crypto path (ponytail: security logic gets one runnable check).
// Run: `node apps/web/src/server/session.check.ts` (Node 24 strips types) or `npx tsx <path>`.
import assert from 'node:assert'
import { openSession, sealSession, type SessionData } from './session.ts'

const KEY = 'a'.repeat(64) // 32 bytes
const OTHER = 'b'.repeat(64)
const sample: SessionData = {
  token: 'gho_example',
  login: 'octocat',
  name: 'The Octocat',
  avatar: 'https://example.com/a.png',
  scopes: ['repo', 'read:org', 'read:user'],
}

const sealed = await sealSession(sample, KEY)

// roundtrip
assert.deepStrictEqual(await openSession(sealed, KEY), sample, 'roundtrip mismatch')
// wrong key → null
assert.strictEqual(await openSession(sealed, OTHER), null, 'wrong key should not open')
// tampered token → null
assert.strictEqual(await openSession(sealed.slice(0, -2) + 'xx', KEY), null, 'tampered should not open')
// garbage → null
assert.strictEqual(await openSession('not-a-jwt', KEY), null, 'garbage should not open')

console.log('session.check: OK')
