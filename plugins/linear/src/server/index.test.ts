import { afterEach, describe, expect, it, vi } from 'vitest'
import { linearUploadTarget } from './routes/linear'
import { issuesFilter, linearData, linearError, linearFetch, parseIdentifier, projectIssueSearchFilter, projectIssuesFilter } from './index'

describe('linear server helpers', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('parses issue identifiers and ignores malformed identifiers in filters', () => {
    expect(parseIdentifier('ENG-42')).toEqual({ key: 'ENG', number: 42 })
    expect(parseIdentifier('eng-42')).toBeNull()
    expect(parseIdentifier('ENG-')).toBeNull()
    expect(issuesFilter(['not-an-issue', 'ENG-42', 'ENG-7'])).toEqual({ team: { key: { eq: 'ENG' } }, number: { in: [42, 7] } })
    expect(issuesFilter(['nope'])).toBeNull()
  })

  it('builds an OR filter for identifiers from multiple teams', () => {
    expect(issuesFilter(['ENG-42', 'OPS-3'])).toEqual({
      or: [
        { team: { key: { eq: 'ENG' } }, number: { in: [42] } },
        { team: { key: { eq: 'OPS' } }, number: { in: [3] } },
      ],
    })
    expect(projectIssuesFilter(['p-1', 'p-2'])).toEqual({
      project: { id: { in: ['p-1', 'p-2'] } },
      state: { type: { nin: ['completed', 'canceled'] } },
    })
  })

  // The palette's filter is the rail's filter with the typed word ANDed onto it: top-level fields are
  // ANDed by Linear and `or` ORs its own list, so this reads "in these projects, still active, and
  // matching one of these" (docs/integrations.md § From the command palette).
  it('narrows the mapped-project filter by what somebody typed', () => {
    expect(projectIssueSearchFilter(['p-1'], 'login')).toEqual({
      project: { id: { in: ['p-1'] } },
      state: { type: { nin: ['completed', 'canceled'] } },
      or: [{ title: { containsIgnoreCase: 'login' } }],
    })
    // An identifier is also a team and a number, which is how a pasted key finds its ticket even when
    // the key appears nowhere in the title.
    expect(projectIssueSearchFilter(['p-1'], ' eng-42 ').or).toEqual([
      { title: { containsIgnoreCase: 'eng-42' } },
      { team: { key: { eq: 'ENG' } }, number: { eq: 42 } },
    ])
    // A bare number, with or without the hash it was copied with.
    expect(projectIssueSearchFilter(['p-1'], '#42').or).toEqual([
      { title: { containsIgnoreCase: '#42' } },
      { number: { eq: 42 } },
    ])
    // Nothing typed is the mapped-project filter unchanged, so opening the frame lists the project.
    expect(projectIssueSearchFilter(['p-1'], '   ')).toEqual(projectIssuesFilter(['p-1']))
  })

  it('maps provider status failures to the stable route errors', () => {
    expect(linearError(new Response('{}'))).toBeNull()
    expect(linearError(new Response('{}', { status: 401 }))).toEqual({ error: 'linear_reauth', status: 401 })
    expect(linearError(new Response('{}', { status: 403 }))).toEqual({ error: 'linear_reauth', status: 401 })
    expect(linearError(new Response('{}', { status: 500 }))).toEqual({ error: 'linear_unavailable', status: 502 })
  })

  it('accepts GraphQL data and rejects GraphQL or empty responses', async () => {
    await expect(linearData<{ value: number }>(new Response(JSON.stringify({ data: { value: 3 } })))).resolves.toEqual({ value: 3 })
    await expect(linearData(new Response(JSON.stringify({ errors: [{ message: 'bad key' }] })))).rejects.toThrow('bad key')
    await expect(linearData(new Response(JSON.stringify({ data: null })))).rejects.toThrow('empty response')
  })
})

describe('linearUploadTarget', () => {
  // The regression: an unbounded call to Linear outlived the fan-out's per-node deadline, so a slow
  // API drew "this node is unavailable" over a node that was answering everything else.
  it('gives every call to Linear a deadline', async () => {
    let init: RequestInit | undefined
    vi.stubGlobal('fetch', (_url: string, options: RequestInit) => {
      init = options
      return Promise.resolve(new Response('{"data":{}}'))
    })
    await linearFetch('key', 'query { viewer { name } }', {})
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('accepts only https uploads.linear.app', () => {
    expect(linearUploadTarget('https://uploads.linear.app/w/f/a.png')?.href).toBe('https://uploads.linear.app/w/f/a.png')
    // Every one of these would otherwise be a request this route makes with the owner's Linear key.
    expect(linearUploadTarget('http://uploads.linear.app/a.png')).toBeNull()
    expect(linearUploadTarget('https://evil.example.com/a.png')).toBeNull()
    expect(linearUploadTarget('https://uploads.linear.app.evil.com/a.png')).toBeNull()
    expect(linearUploadTarget('https://evil.com/?x=uploads.linear.app')).toBeNull()
    expect(linearUploadTarget('file:///etc/passwd')).toBeNull()
    expect(linearUploadTarget('/relative')).toBeNull()
    expect(linearUploadTarget(undefined)).toBeNull()
  })
})
