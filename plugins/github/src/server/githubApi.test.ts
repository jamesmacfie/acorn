import { afterEach, describe, expect, it, vi } from 'vitest'
import { gh, ghGraphQL, graphQLOperation, restOperation, setGithubApiTelemetry } from './githubApi'

afterEach(() => {
  setGithubApiTelemetry(undefined)
  vi.unstubAllGlobals()
})

describe('the operation a call is filed under', () => {
  it.each([
    ['/user', 'user'],
    ['/user/repos?sort=pushed&direction=desc&per_page=100', 'user.repos'],
    ['/search/issues?q=repo%3Aacme%2Fwidget', 'search.issues'],
    ['/repos/acme/widget', 'repo'],
    ['/repos/acme/widget/pulls?state=open', 'pulls'],
    ['/repos/acme/widget/pulls/12', 'pull'],
    ['/repos/acme/widget/pulls/12/files?per_page=100&page=2', 'pull.files'],
    ['/repos/acme/widget/pulls/12/comments/99/replies', 'pull.comment.replies'],
    ['/repos/acme/widget/issues/12/labels/needs%20review', 'issue.labels'],
    ['/repos/acme/widget/compare/main...feat/secret-branch?per_page=100', 'compare'],
    ['/repos/acme/widget/actions/runs/7/attempts/2/jobs?per_page=100&page=1', 'actions.jobs'],
    ['/repos/acme/widget/actions/jobs/8/rerun', 'actions.rerun'],
    ['/repos/acme/widget/actions/jobs/8/logs', 'actions.job.logs'],
    ['/orgs/acme/members', 'other'],
  ])('%s is %s', (path, operation) => {
    expect(restOperation(path)).toBe(operation)
  })

  it('names a GraphQL call by its first field, past an alias', () => {
    expect(graphQLOperation('query($owner: String!) { repository(owner: $owner) { id } }')).toBe('graphql.repository')
    expect(graphQLOperation('mutation($id: ID!) { m: mergePullRequest(input: {}) { clientMutationId } }')).toBe(
      'graphql.mergePullRequest',
    )
  })
})

describe('the github.api span', () => {
  const recording = () => {
    const spans: { name: string; attrs?: Record<string, unknown>; status?: string; end?: Record<string, unknown> }[] =
      []
    setGithubApiTelemetry({
      enabled: () => true,
      startSpan: (name, options) => {
        const span: (typeof spans)[number] = { name, attrs: options?.attrs }
        spans.push(span)
        return {
          traceId: 't',
          spanId: 's',
          end: (status = 'ok', attrs) => {
            span.status = status
            span.end = attrs
          },
        }
      },
    })
    return spans
  }

  it('carries the operation, method and status, and says when the rate limit runs low', async () => {
    const spans = recording()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('{}', { status: 200, headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '12' } }),
      ),
    )
    await gh('token', '/repos/acme/widget/pulls/12/merge', { method: 'PUT' })
    await ghGraphQL('token', 'query { viewer { login } }', {})
    expect(spans).toEqual([
      {
        name: 'github.api',
        attrs: { operation: 'pull.merge', method: 'PUT' },
        status: 'ok',
        end: { status: 200, 'ratelimit.low': true },
      },
      {
        name: 'github.api',
        attrs: { operation: 'graphql.viewer', method: 'POST' },
        status: 'ok',
        end: { status: 200, 'ratelimit.low': true },
      },
    ])
    expect(JSON.stringify(spans)).not.toContain('acme')
  })

  it('marks a failed call as an error and rethrows', async () => {
    const spans = recording()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    await expect(gh('token', '/user')).rejects.toThrow('offline')
    expect(spans[0]).toMatchObject({ status: 'error', end: { status: 0 } })
  })
})
