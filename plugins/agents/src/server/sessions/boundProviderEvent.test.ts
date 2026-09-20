import { describe, expect, it } from 'vitest'
import { boundProviderEvent } from './boundProviderEvent'

describe('provider event storage bounds', () => {
  it('bounds request collections and redacts diagnostics before persistence', () => {
    const request = boundProviderEvent({
      type: 'request',
      requestId: 'r',
      kind: 'question',
      title: 't'.repeat(1_000),
      options: Array.from({ length: 150 }, (_, index) => ({
        id: String(index),
        label: 'label',
        kind: 'other' as const,
      })),
    }, [])
    expect(request.type === 'request' && request.title).toHaveLength(500)
    expect(request.type === 'request' && request.options).toHaveLength(100)

    const diagnostic = boundProviderEvent({
      type: 'diagnostic',
      level: 'warning',
      message: 'token=private-token-value',
    }, ['private-token-value'])
    expect(diagnostic.type === 'diagnostic' ? diagnostic.message : '').not.toContain('private-token-value')
  })
})

// Web activity is the largest thing a provider hands this ledger unasked: the model writes the
// query, a search engine decides how many sources come back, and every title and snippet is somebody
// else's HTML. These cases are the ceiling on all of it.
describe('web activity bounds', () => {
  const web = (tool: Partial<import('@acorn/protocol/managedAgents.ts').AgentToolCall>) => {
    const event = boundProviderEvent({
      type: 'tool',
      tool: { id: 't', title: 'Search web', status: 'completed', ...tool },
    }, [])
    return event.type === 'tool' ? event.tool.web : undefined
  }

  it('bounds every string and every collection a search can carry', () => {
    const bounded = web({
      web: {
        action: {
          type: 'search',
          queries: Array.from({ length: 40 }, () => 'q'.repeat(5_000)),
          allowedDomains: Array.from({ length: 200 }, () => 'd'.repeat(500)),
        },
        results: Array.from({ length: 80 }, (_, index) => ({
          url: `https://example.com/${index}?${'p'.repeat(20)}`,
          title: 't'.repeat(1_000),
          domain: 'd'.repeat(500),
          snippet: 's'.repeat(9_000),
        })),
      },
    })
    const action = bounded?.action
    expect(action?.type === 'search' && action.queries).toHaveLength(10)
    expect(action?.type === 'search' && action.queries[0]).toHaveLength(1_000)
    expect(action?.type === 'search' && action.allowedDomains).toHaveLength(20)
    expect(action?.type === 'search' && action.allowedDomains?.[0]).toHaveLength(253)
    expect(bounded?.results?.[0].title).toHaveLength(500)
    expect(bounded?.results?.[0].domain).toHaveLength(253)
    expect(bounded?.results?.[0].snippet).toHaveLength(2_000)
  })

  it('keeps the whole payload under the inline event budget, and keeps the action while doing it', () => {
    const bounded = web({
      web: {
        action: { type: 'search', queries: ['the query that explains the call'] },
        results: Array.from({ length: 50 }, (_, index) => ({
          url: `https://example.com/${index}`,
          title: 't'.repeat(500),
          snippet: 's'.repeat(4_096),
        })),
      },
    })
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThanOrEqual(64 * 1024)
    // Trailing sources go first, and the query that says what the call was never does.
    expect(bounded?.results?.length).toBeGreaterThan(0)
    expect(bounded?.results?.length).toBeLessThan(50)
    expect(bounded?.action).toEqual({ type: 'search', queries: ['the query that explains the call'], allowedDomains: undefined, blockedDomains: undefined })
  })

  it('leaves an action that is maximal on every field well inside the budget on its own', () => {
    // What makes the trim above able to finish: if the action could be over budget by itself, there
    // would be nothing left to drop.
    const bounded = web({
      web: {
        action: {
          type: 'search',
          queries: Array.from({ length: 10 }, () => 'q'.repeat(1_000)),
          allowedDomains: Array.from({ length: 20 }, () => 'd'.repeat(253)),
          blockedDomains: Array.from({ length: 20 }, () => 'd'.repeat(253)),
        },
      },
    })
    expect(Buffer.byteLength(JSON.stringify(bounded), 'utf8')).toBeLessThan(64 * 1024)
  })

  it('leaves a hostile URL intact for the renderer to refuse rather than half-cleaning it here', () => {
    // Scheme is a rendering decision, and a truncated `javascript:` is worse than a whole one: it
    // would still be stored, and it would no longer look like what it is.
    const bounded = web({ web: { results: [{ url: 'javascript:alert(1)' }, { url: 'data:text/html,<script>' }] } })
    expect(bounded?.results?.map((result) => result.url)).toEqual(['javascript:alert(1)', 'data:text/html,<script>'])
  })
})
