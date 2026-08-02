import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { makeTestDb, type TestDb } from '@acorn/node-core/server/routes/testDb.ts'
import type { HttpSendInput } from '../shared/model'
import { SendError, buildRequest, describeFetchFailure, readCapped, referencedVariableNames, resolveVars, send } from './send'
import { protectHttpValue } from './storage'

// buildRequest is where interpolation, auth compilation and the scheme check land — the parts that
// would silently send the wrong thing. The fetch call itself and the DB read around it are thin.

const input = (patch: Partial<HttpSendInput> = {}): HttpSendInput => ({
  method: 'GET',
  url: 'http://x/y',
  headers: [],
  bodyMode: 'none',
  body: '',
  auth: { mode: 'none' },
  vars: {},
  executionTaskId: null,
  ...patch,
})
const USER = 'octocat'
const ENC_KEY = '0'.repeat(64)

describe('buildRequest — scheme', () => {
  it('rejects anything that is not http or https', () => {
    for (const url of ['file:///etc/passwd', 'ftp://x/y', 'data:text/plain,hi']) {
      expect(() => buildRequest(input({ url }), {})).toThrow(SendError)
    }
  })

  it('rejects a URL that will not parse at all', () => {
    expect(() => buildRequest(input({ url: 'not a url' }), {})).toThrow(/Not a valid URL/)
  })

  it('accepts http and https', () => {
    expect(buildRequest(input({ url: 'http://x' }), {}).target.protocol).toBe('http:')
    expect(buildRequest(input({ url: 'https://x' }), {}).target.protocol).toBe('https:')
  })

  it('rejects a scheme smuggled in through a variable', () => {
    expect(() => buildRequest(input({ url: '{{BASE}}/y' }), { BASE: 'file:///etc' })).toThrow(SendError)
  })
})

describe('buildRequest — interpolation', () => {
  it('fills the URL from variables', () => {
    const { target } = buildRequest(input({ url: '{{BASE}}/users/{{id}}' }), { BASE: 'http://x', id: '7' })
    expect(target.toString()).toBe('http://x/users/7')
  })

  it('fills header names and values', () => {
    const { headers } = buildRequest(input({ headers: [{ name: 'X-{{H}}', value: '{{V}}', enabled: true }] }), { H: 'Trace', V: 'abc' })
    expect(headers.get('x-trace')).toBe('abc')
  })

  it('skips disabled and unnamed headers', () => {
    const { headers } = buildRequest(
      input({
        headers: [
          { name: 'A', value: '1', enabled: false },
          { name: '', value: '2', enabled: true },
        ],
      }),
      {},
    )
    expect([...headers.keys()]).toEqual([])
  })

  it('fills the body', () => {
    const { body } = buildRequest(input({ bodyMode: 'json', body: '{"id":"{{id}}"}' }), { id: '7' })
    expect(body).toBe('{"id":"7"}')
  })

  it('fills auth fields', () => {
    const { headers } = buildRequest(input({ auth: { mode: 'bearer', token: '{{TOKEN}}' } }), { TOKEN: 'sekrit' })
    expect(headers.get('authorization')).toBe('Bearer sekrit')
  })

  it('leaves an unresolved placeholder literal rather than sending "undefined"', () => {
    const { headers } = buildRequest(input({ headers: [{ name: 'A', value: '{{nope}}', enabled: true }] }), {})
    expect(headers.get('a')).toBe('{{nope}}')
  })
})

describe('referencedVariableNames', () => {
  it('finds placeholders in active request fields only', () => {
    const names = referencedVariableNames(input({
      url: '{{URL}}',
      headers: [
        { name: 'X-{{HEADER_NAME}}', value: '{{HEADER_VALUE}}', enabled: true },
        { name: 'Ignored', value: '{{DISABLED}}', enabled: false },
      ],
      bodyMode: 'json',
      body: '{"id":"{{BODY}}"}',
      auth: { mode: 'bearer', token: '{{TOKEN}}' },
    }))

    expect([...names].sort()).toEqual(['BODY', 'HEADER_NAME', 'HEADER_VALUE', 'TOKEN', 'URL'])
  })
})

describe('buildRequest — content type', () => {
  it('defaults by body mode', () => {
    expect(buildRequest(input({ bodyMode: 'json', body: '{}' }), {}).headers.get('content-type')).toBe('application/json')
    expect(buildRequest(input({ bodyMode: 'text', body: 'hi' }), {}).headers.get('content-type')).toBe('text/plain')
    expect(buildRequest(input({ bodyMode: 'form', body: '[{"name":"a","value":"1","enabled":true}]' }), {}).headers.get('content-type')).toBe('application/x-www-form-urlencoded')
  })

  it('never overrides an explicit Content-Type', () => {
    const { headers } = buildRequest(input({ bodyMode: 'json', body: '{}', headers: [{ name: 'Content-Type', value: 'application/vnd.api+json', enabled: true }] }), {})
    expect(headers.get('content-type')).toBe('application/vnd.api+json')
  })

  it('sets no content type when there is no body', () => {
    expect(buildRequest(input({ bodyMode: 'none' }), {}).headers.has('content-type')).toBe(false)
    expect(buildRequest(input({ bodyMode: 'json', body: '' }), {}).body).toBeUndefined()
  })
})

describe('buildRequest — api key placement', () => {
  it('adds a header key as a header', () => {
    const { target, headers } = buildRequest(input({ auth: { mode: 'apikey', key: 'X-Key', value: 'k', placement: 'header' } }), {})
    expect(headers.get('x-key')).toBe('k')
    expect(target.search).toBe('')
  })

  it('merges a query key into the URL alongside existing params', () => {
    const { target, headers } = buildRequest(input({ url: 'http://x/y?a=1', auth: { mode: 'apikey', key: 'k', value: 'v', placement: 'query' } }), {})
    expect(target.searchParams.get('a')).toBe('1')
    expect(target.searchParams.get('k')).toBe('v')
    expect(headers.has('k')).toBe(false)
  })
})

describe('readCapped', () => {
  const streamOf = (chunks: Uint8Array[]): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(c)
          controller.close()
        },
      }),
    )

  it('returns the whole body when it fits', async () => {
    const { bytes, truncated } = await readCapped(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]))
    expect([...bytes]).toEqual([1, 2, 3])
    expect(truncated).toBe(false)
  })

  it('handles an empty body', async () => {
    const { bytes, truncated } = await readCapped(new Response(null))
    expect(bytes.byteLength).toBe(0)
    expect(truncated).toBe(false)
  })

  it('stops at the 5 MB cap and flags it', async () => {
    // Two 4 MB chunks: the first fits, the second is cut short at the cap.
    const chunk = new Uint8Array(4 * 1024 * 1024).fill(7)
    const { bytes, truncated } = await readCapped(streamOf([chunk, chunk]))
    expect(bytes.byteLength).toBe(5 * 1024 * 1024)
    expect(truncated).toBe(true)
    expect(bytes[bytes.byteLength - 1]).toBe(7)
  })
})

describe('resolveVars — command execution context', () => {
  let testDb: TestDb | null = null
  let root: string | null = null

  afterEach(() => {
    testDb?.cleanup()
    testDb = null
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  it('runs a command in the explicit task worktree and uses its last non-empty output line', async () => {
    testDb = makeTestDb()
    root = mkdtempSync(join(tmpdir(), 'acorn-http-command-'))
    const worktree = join(root, 'worktree')
    const base = join(root, 'base')
    mkdirSync(worktree)
    mkdirSync(base)
    await testDb.db.insert(schema.repoPaths).values({ owner: 'acme', repo: 'widget', path: base, createdAt: 0, updatedAt: 0 })
    await testDb.db.insert(schema.tasks).values({
      id: 'task-1',
      title: 'API task',
      origin: 'local',
      repoOwner: 'acme',
      repoName: 'widget',
      branch: 'feature/api-url',
      worktreePath: worktree,
      pullNumber: null,
      status: 'active',
      parentId: null,
      sort: 0,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    })
    await testDb.db.insert(schema.httpVariables).values({
      id: 'var-1',
      userId: USER,
      repoOwner: 'acme',
      repoName: 'widget',
      name: 'BASE_URL',
      kind: 'command',
      value: await protectHttpValue(`printf 'shell startup noise\\n%s|%s|%s\\n' "$PWD" "$ACORN_TASK_ID" "$ACORN_BRANCH"`, ENC_KEY),
      encrypted: true,
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    })

    const vars = await resolveVars(testDb.db, USER, 'acme', 'widget', ENC_KEY, input({ url: '{{BASE_URL}}/health', executionTaskId: 'task-1' }))

    const [commandCwd, taskId, branch] = vars.BASE_URL.split('|')
    expect(realpathSync(commandCwd)).toBe(realpathSync(worktree))
    expect(taskId).toBe('task-1')
    expect(branch).toBe('feature/api-url')
    expect(realpathSync(vars.worktree)).toBe(realpathSync(worktree))
    expect(vars.branch).toBe('feature/api-url')
  })

  it('rejects an execution task from another repo', async () => {
    testDb = makeTestDb()
    await testDb.db.insert(schema.tasks).values({
      id: 'task-2',
      title: 'Other task',
      origin: 'local',
      repoOwner: 'acme',
      repoName: 'other',
      branch: 'main',
      worktreePath: null,
      pullNumber: null,
      status: 'active',
      parentId: null,
      sort: 0,
      createdAt: 0,
      updatedAt: 0,
      archivedAt: null,
    })

    await expect(resolveVars(testDb.db, USER, 'acme', 'widget', ENC_KEY, input({ executionTaskId: 'task-2' }))).rejects.toThrow(
      'The selected task belongs to acme/other',
    )
  })

  it('does not run an unused or request-overridden command variable', async () => {
    testDb = makeTestDb()
    await testDb.db.insert(schema.httpVariables).values({
      id: 'var-unused',
      userId: USER,
      repoOwner: 'acme',
      repoName: 'widget',
      name: 'BASE_URL',
      kind: 'command',
      value: await protectHttpValue('exit 17', ENC_KEY),
      encrypted: true,
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    })

    await expect(resolveVars(testDb.db, USER, 'acme', 'widget', ENC_KEY, input())).resolves.not.toHaveProperty('BASE_URL')
    await expect(
      resolveVars(testDb.db, USER, 'acme', 'widget', ENC_KEY, input({ url: '{{BASE_URL}}/health', vars: { BASE_URL: 'http://override.test' } })),
    ).resolves.toMatchObject({ BASE_URL: 'http://override.test' })
  })
})

describe('send — transport outcomes', () => {
  let testDb: TestDb | null = null

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb?.cleanup()
    testDb = null
  })

  it('keeps the system error behind Node’s generic fetch failure', async () => {
    const cause = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:4321'), { code: 'ECONNREFUSED' })
    const failure = describeFetchFailure(new TypeError('fetch failed', { cause }), new URL('http://127.0.0.1:4321/health'))

    expect(failure).toEqual({
      error: 'Connection refused by 127.0.0.1:4321. The server may not be running or may be listening on a different port.',
      code: 'ECONNREFUSED',
      detail: 'connect ECONNREFUSED 127.0.0.1:4321',
    })
  })

  it('returns a failed attempt with its URL and timeline when no response exists', async () => {
    testDb = makeTestDb()
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND missing.test'), { code: 'ENOTFOUND' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed', { cause })))

    const result = await send(testDb.db, USER, 'acme', 'widget', ENC_KEY, input({ url: 'http://missing.test/health' }))

    expect(result).toMatchObject({
      ok: false,
      code: 'ENOTFOUND',
      url: 'http://missing.test/health',
      error: 'Could not find missing.test. Check the host name or DNS.',
    })
    expect(result.timeline).toEqual(expect.arrayContaining([
      { label: 'request', detail: 'GET http://missing.test/health' },
      expect.objectContaining({ label: 'error', detail: expect.stringContaining('ENOTFOUND') }),
    ]))
  })

  it('keeps an HTTP 500 as a response, including its body', async () => {
    testDb = makeTestDb()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('server broke', { status: 500, statusText: 'Internal Server Error' })))

    const result = await send(testDb.db, USER, 'acme', 'widget', ENC_KEY, input({ url: 'http://api.test/fail' }))

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('Expected an HTTP response')
    expect(result.status).toBe(500)
    expect(Buffer.from(result.bodyBase64, 'base64').toString()).toBe('server broke')
  })

  it('does not return resolved server-side secrets in URLs or request timelines', async () => {
    testDb = makeTestDb()
    await testDb.db.insert(schema.httpVariables).values({
      id: 'secret-var',
      userId: USER,
      repoOwner: 'acme',
      repoName: 'widget',
      name: 'TOKEN',
      kind: 'secret',
      value: await protectHttpValue('server-only-secret', ENC_KEY),
      encrypted: true,
      enabled: true,
      createdAt: 1,
      updatedAt: 1,
    })
    const fetcher = vi.fn().mockResolvedValue(new Response('ok'))
    vi.stubGlobal('fetch', fetcher)

    const result = await send(
      testDb.db,
      USER,
      'acme',
      'widget',
      ENC_KEY,
      input({
        url: 'https://api.test/items/server-only-secret?token={{TOKEN}}',
        headers: [{ name: 'X-API-Key', value: '{{TOKEN}}', enabled: true }],
      }),
    )

    expect(String(fetcher.mock.calls[0]?.[0])).toContain('server-only-secret')
    expect(JSON.stringify(result)).not.toContain('server-only-secret')
    expect(JSON.stringify(result)).toContain('••••••')
  })
})
