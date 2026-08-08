import { describe, expect, it } from 'vitest'
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
