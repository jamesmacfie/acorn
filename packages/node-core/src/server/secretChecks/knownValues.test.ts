import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestDb } from '../../testkit/db'
import { readAudit } from '../audit'
import { auditCarriedKeys, createKnownValueIndex } from './knownValues'

// Synthetic values, assembled at runtime so no key literal sits in this file. Each seed gives a
// different random-looking string over the same alphabet.
const ALPHABET = 'A1b2C3d4E5f6G7h8J9k0LmNpQrStUvWxYz'
const value = (seed: number, length = 32) =>
  Array.from({ length }, (_, index) => ALPHABET[(index * seed + seed) % ALPHABET.length]).join('')
const [A, B, C, D, E, F] = [3, 5, 7, 11, 13, 19].map((seed) => value(seed))

let home: string
let task: string

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'known-home-'))
  task = mkdtempSync(join(tmpdir(), 'known-task-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
  rmSync(task, { recursive: true, force: true })
})

const write = (folder: string, path: string, text: string) => {
  mkdirSync(join(folder, path, '..'), { recursive: true })
  writeFileSync(join(folder, path), text)
}
const index = (env: NodeJS.ProcessEnv = {}) => createKnownValueIndex({ home, env })
const found = async (text: string, env: NodeJS.ProcessEnv = {}) => (await index(env).lookup(text, task)).matches

describe('createKnownValueIndex sources', () => {
  it('reads dotenv lines: quotes, export, comments, and CRLF', async () => {
    write(
      task,
      '.env.local',
      [
        `STRIPE_SECRET_KEY="${A}" # live`,
        `export API_TOKEN='${B}'`,
        `DB_PASSWORD=${C} # note`,
        `SIGNING_SECRET=${D}\r`,
      ].join('\n'),
    )
    expect(await found(`curl -d ${A} ${B} ${C} ${D}`)).toEqual([
      { name: 'STRIPE_SECRET_KEY', source: '.env.local' },
      { name: 'API_TOKEN', source: '.env.local' },
      { name: 'DB_PASSWORD', source: '.env.local' },
      { name: 'SIGNING_SECRET', source: '.env.local' },
    ])
  })

  it('reads .envrc and *.env, and skips example files', async () => {
    write(task, '.envrc', `export WEBHOOK_SECRET=${A}`)
    write(task, 'prod.env', `API_KEY=${B}`)
    write(task, '.env.example', `API_KEY=${C}`)
    write(task, 'sample.env', `API_KEY=${D}`)
    expect(await found(`${A} ${B} ${C} ${D}`)).toEqual([
      { name: 'WEBHOOK_SECRET', source: '.envrc' },
      { name: 'API_KEY', source: 'prod.env' },
    ])
  })

  it('reads AWS credentials, npmrc, netrc, and Docker auths from the home folder', async () => {
    write(home, '.aws/credentials', `[default]\naws_access_key_id = ${E}\naws_secret_access_key = /${A}`)
    write(home, '.npmrc', `//registry.npmjs.org/:_authToken=${B}`)
    write(home, '.netrc', `machine api.example.com\n  login me\n  password ${C}`)
    const auth = Buffer.from(`me:${D}`).toString('base64')
    write(home, '.docker/config.json', JSON.stringify({ auths: { 'ghcr.io': { auth } } }))
    expect(await found(`/${A} ${B} ${C} ${D} ${auth} ${E}`)).toEqual([
      { name: 'aws_secret_access_key', source: '~/.aws/credentials' },
      { name: '//registry.npmjs.org/:_authToken', source: '~/.npmrc' },
      { name: 'password (api.example.com)', source: '~/.netrc' },
      { name: 'password (ghcr.io)', source: '~/.docker/config.json' },
      { name: 'auth (ghcr.io)', source: '~/.docker/config.json' },
    ])
  })

  it('reads secret-looking names from the environment', async () => {
    expect(await found(`${A} ${B}`, { GITHUB_TOKEN: A, EDITOR_THEME: B })).toEqual([
      { name: 'GITHUB_TOKEN', source: "Acorn's environment" },
    ])
  })

  it('rereads a file when it changes', async () => {
    const known = index()
    write(task, '.env', `API_KEY=${A}`)
    expect((await known.lookup(B, task)).matches).toEqual([])
    write(task, '.env', `API_KEY=${A}\nOTHER_TOKEN=${B}xyz`)
    expect((await known.lookup(`${B}xyz`, task)).matches).toEqual([{ name: 'OTHER_TOKEN', source: '.env' }])
  })
})

describe('createKnownValueIndex filters', () => {
  it.each([
    ['a name that is not secret-looking', `GREETING=${A}`, A],
    ['an excluded name', `AUTH_URL=${A}`, A],
    ['a short value', 'API_KEY=Ab3dE5gH9k', 'Ab3dE5gH9k'],
    ['a placeholder', `API_KEY=your-${A}`, `your-${A}`],
    ['a path', `API_KEY=/usr/local/${A}`, `/usr/local/${A}`],
    ['a host', 'API_KEY=a1b2c3.d4e5f6.internal.net', 'a1b2c3.d4e5f6.internal.net'],
    ['a URL with no password', `SESSION_SECRET=https://api.acme.io/${A}`, `https://api.acme.io/${A}`],
    ['a low-entropy value', 'API_KEY=abababababababababab12', 'abababababababababab12'],
  ])('drops %s', async (_case, line, text) => {
    write(task, '.env', line)
    expect(await found(`echo ${text}`)).toEqual([])
  })

  it('keeps a URL with a password', async () => {
    const url = `postgres://app:${A}@db.internal:5432/app`
    write(task, '.env', `DATABASE_DSN=${url}`)
    expect(await found(`psql "${url}"`)).toEqual([{ name: 'DATABASE_DSN', source: '.env' }])
  })
})

describe('createKnownValueIndex lookup', () => {
  beforeEach(() => write(task, '.env.local', `STRIPE_SECRET_KEY=${A}\nDB_PASSWORD=p@ss/${B}`))

  it.each([
    ['a JSON tool input with escapes', JSON.stringify({ command: `printf "x\n${A}"` })],
    ['a header value', `curl -H 'Authorization: Bearer ${A}' https://api.example.com`],
    ['a query string', `https://api.example.com/v1?key=${A}&x=1`],
    ['a URL-encoded value', `curl -d secret=${encodeURIComponent(`p@ss/${B}`)}`],
    ['a value with / and @ inside', `mysql -p"p@ss/${B}"`],
  ])('finds the value in %s', async (_case, text) => {
    expect((await found(text)).length).toBe(1)
  })

  it('reads only the home files and the environment without a folder', async () => {
    expect((await index().lookup(A, null)).matches).toEqual([])
  })

  it('finds a value on a window edge and at the end of 2 MiB, and says when it stopped', async () => {
    const known = index()
    const pad = (length: number) => ' '.repeat(length)
    const straddles = `${pad(256 * 1024 - 10)}${A}`
    expect((await known.lookup(straddles, task)).matches).toEqual([{ name: 'STRIPE_SECRET_KEY', source: '.env.local' }])
    const atEnd = `${pad(2 * 1024 * 1024 - A.length)}${A}`
    expect(await known.lookup(atEnd, task)).toEqual({
      matches: [{ name: 'STRIPE_SECRET_KEY', source: '.env.local' }],
      truncated: false,
    })
    expect(await known.lookup(`${pad(2 * 1024 * 1024)} ${A}`, task)).toEqual({ matches: [], truncated: true })
  })

  it('lists sources with names and never a value', async () => {
    const known = index({ API_TOKEN: F })
    await known.lookup('', task)
    const sources = await known.sources()
    expect(sources).toEqual([
      { source: '.env.local', folder: task, names: ['DB_PASSWORD', 'STRIPE_SECRET_KEY'] },
      { source: "Acorn's environment", folder: null, names: ['API_TOKEN'] },
    ])
    for (const secret of [A, B, F]) expect(JSON.stringify(sources)).not.toContain(secret.slice(4, 20))
  })
})

describe('auditCarriedKeys', () => {
  it('writes one audit row with the names and no value, and none for a clean call', async () => {
    const test = makeTestDb()
    try {
      write(task, '.env', `STRIPE_SECRET_KEY=${A}`)
      const known = index()
      const call = { sessionId: 's1', toolCallId: 'call-1', folder: task }
      expect(await auditCarriedKeys(test.db, known, { ...call, text: `curl -u ${A}:` })).toEqual([
        { name: 'STRIPE_SECRET_KEY', source: '.env' },
      ])
      expect(await auditCarriedKeys(test.db, known, { ...call, toolCallId: 'call-2', text: 'ls' })).toEqual([])
      await vi.waitFor(async () => expect(await readAudit(test.db)).toHaveLength(1))
      const [row] = await readAudit(test.db)
      expect(row).toMatchObject({
        action: 'secrets.agent.carried',
        subject: 's1',
        details: { toolCallId: 'call-1', names: 'STRIPE_SECRET_KEY' },
      })
      expect(JSON.stringify(row)).not.toContain(A.slice(4, 20))
    } finally {
      test.cleanup()
    }
  })
})
