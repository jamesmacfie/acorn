import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { privacyProblems } from './snapshotPrivacy.mjs'

// Every committed shell snapshot is pictures of an invented world (docs/site.md § Shell snapshots).
// One that carries anything from the machine that captured it fails here, and the fix is the fixture.

const DIR = new URL('../src/generated/snapshots/', import.meta.url)

test('no committed snapshot carries real data', () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith('.html') || name.endsWith('.cells.json'))
  assert.ok(files.length > 0, 'no snapshots found')
  for (const name of files) assert.deepEqual(privacyProblems(readFileSync(new URL(name, DIR), 'utf8')), [], name)
})

test('finds each kind of real data', () => {
  const planted = {
    'a home folder path': '<span>/Users/ana/Source/billing-api</span>',
    'a Linux home folder path': 'cwd /home/ana/billing-api',
    'an email address outside example.com': 'ana@fernwood.dev',
    'a GitHub token': 'ghp_abcdefghijklmnop1234',
    'a bearer header': 'authorization: Bearer abc.def.ghi',
    'a long hex run': '3f9a2c1e3f9a2c1e3f9a2c1e3f9a2c1e',
    'a long base64 run': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9xYzAbc',
    'a hostname': '<a href="https://billing.fernwood.dev/invoices">',
  }
  for (const [kind, text] of Object.entries(planted)) assert.equal(privacyProblems(text).length, 1, kind)
})

test("leaves the fixture's own data alone", () => {
  const fixture = [
    'ana@example.com',
    'https://hooks.example.com/fernwood',
    'https://github.com/fernwood/billing-api.git',
    'billing/webhooks/backoff.py',
    'commit 54356a9ea',
    'b8d76c09-53b0-4f8e-9c54-4cd0c1b581a4',
  ]
  for (const text of fixture) assert.deepEqual(privacyProblems(text), [], text)
})
