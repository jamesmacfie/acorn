import { describe, expect, it } from 'vitest'
import { linearUploadTarget } from './routes/linear'
import { issuesFilter, linearData, linearError, parseIdentifier, projectIssuesFilter } from './index'

describe('linear server helpers', () => {
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
