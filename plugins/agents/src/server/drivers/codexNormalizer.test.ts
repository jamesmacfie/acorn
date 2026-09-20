import { describe, expect, it } from 'vitest'
import {
  codexServerRequestResponse,
  normalizeCodexNotification,
  normalizeCodexServerRequest,
} from './codexNormalizer'
import capture from './__fixtures__/codexWebSearchWire.json' with { type: 'json' }

describe('Codex app-server normalization', () => {
  it('maps protocol readiness without terminal heuristics', () => {
    expect(normalizeCodexNotification({
      method: 'thread/status/changed',
      params: { threadId: 'thread-1', status: { type: 'idle' } },
    })).toEqual([{ type: 'session_state', state: 'ready' }])
  })

  it('maps approval identity and advertised choices', () => {
    const event = normalizeCodexServerRequest({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: { command: 'git push', reason: 'network' },
    })
    expect(event).toMatchObject({
      type: 'request',
      requestId: '42',
      kind: 'permission',
      detail: 'git push',
    })
    expect(event?.type === 'request' ? event.options?.map((option) => option.id) : []).toContain('acceptForSession')
  })

  it('turns an empty MCP form into consent controls and translates their answers', () => {
    const request = {
      id: 7,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'openai/form',
        message: 'Allow Computer Use to use "Firefox Developer Edition"?',
        requestedSchema: { type: 'object', properties: {} },
      },
    }

    expect(normalizeCodexServerRequest(request)).toEqual({
      type: 'request',
      requestId: '7',
      kind: 'elicitation',
      title: 'Allow Computer Use to use "Firefox Developer Edition"?',
      questions: [],
      options: [
        { id: 'accept', label: 'Allow', kind: 'allow_once' },
        { id: 'decline', label: 'Decline', kind: 'reject_once' },
      ],
    })
    expect(codexServerRequestResponse(request, { optionId: 'accept' }))
      .toEqual({ action: 'accept', content: {} })
    expect(codexServerRequestResponse(request, { optionId: 'decline' }))
      .toEqual({ action: 'decline' })
    expect(codexServerRequestResponse(request, null)).toEqual({ action: 'cancel' })
  })

  it('turns an MCP form schema into questions and sends typed content back', () => {
    const request = {
      id: 8,
      method: 'mcpServer/elicitation/request',
      params: {
        mode: 'form',
        message: 'Choose how to continue.',
        requestedSchema: {
          type: 'object',
          properties: {
            browser: {
              type: 'string',
              title: 'Browser',
              oneOf: [
                { const: 'firefox-dev', title: 'Firefox Developer Edition' },
                { const: 'safari', title: 'Safari' },
              ],
            },
            retries: { type: 'integer', title: 'Retry count' },
          },
        },
      },
    }

    expect(normalizeCodexServerRequest(request)).toMatchObject({
      type: 'request',
      requestId: '8',
      kind: 'question',
      title: 'Choose how to continue.',
      questions: [
        {
          id: 'browser',
          prompt: 'Browser',
          options: [
            { id: 'firefox-dev', label: 'Firefox Developer Edition' },
            { id: 'safari', label: 'Safari' },
          ],
        },
        { id: 'retries', prompt: 'Retry count' },
      ],
      options: [{ id: 'decline', label: 'Skip', kind: 'reject_once' }],
    })
    expect(codexServerRequestResponse(request, {
      answers: { browser: 'Firefox Developer Edition', retries: '2' },
    })).toEqual({
      action: 'accept',
      content: { browser: 'firefox-dev', retries: 2 },
    })
  })

  it('maps message deltas and usage', () => {
    expect(normalizeCodexNotification({
      method: 'item/agentMessage/delta',
      params: { itemId: 'message-1', delta: 'hello' },
    })).toEqual([{ type: 'assistant_message', text: 'hello', messageId: 'message-1', append: true }])
    expect(normalizeCodexNotification({
      method: 'thread/tokenUsage/updated',
      params: {
        tokenUsage: {
          total: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 1, totalTokens: 17 },
          modelContextWindow: 100,
        },
      },
    })).toEqual([{ type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, cacheWriteInputTokens: 1, contextUsed: 17, contextSize: 100 } }])
  })

  it('maps each Codex plan snapshot with its structured status intact', () => {
    expect(normalizeCodexNotification({
      method: 'turn/plan/updated',
      params: {
        plan: [
          { step: 'Inspect `session/start`', status: 'completed' },
          { step: 'Update the projection', status: 'inProgress' },
          { step: 'Verify the UI', status: 'pending' },
        ],
      },
    })).toEqual([{
      type: 'plan',
      entries: [
        { id: 'plan-0', text: 'Inspect `session/start`', status: 'completed' },
        { id: 'plan-1', text: 'Update the projection', status: 'in_progress' },
        { id: 'plan-2', text: 'Verify the UI', status: 'pending' },
      ],
    }])
  })

  it('extracts completed generated images as transient provider artifacts', async () => {
    const result = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
    const notification = {
      method: 'item/completed',
      params: {
        item: {
          type: 'imageGeneration',
          id: 'image-1',
          status: 'completed',
          result,
        },
      },
    }

    const { codexGeneratedArtifact } = await import('./codexNormalizer')
    const artifact = codexGeneratedArtifact(notification)
    expect(artifact).toMatchObject({
      type: 'generated_artifact',
      kind: 'file',
      title: 'Generated image.png',
      mediaType: 'image/png',
    })
    expect(Array.from(artifact?.bytes ?? [])).toEqual(Array.from(Buffer.from(result, 'base64')))
    expect(normalizeCodexNotification(notification)).toEqual([{
      type: 'tool',
      tool: { id: 'image-1', title: 'Generated image', kind: 'image', status: 'completed' },
    }])
  })
})

// Codex's web activity, against the wire it actually sends
// (./__fixtures__/codexWebSearchWire.json, codex-cli 0.154.0).
//
// The capture is the authority for the two actions a live model produced. `findInPage` is in the
// generated app-server schema and never came back from a run, so its case below is written from that
// schema and says so, which is the rule this repository holds captures to.
describe('Codex web activity, against the captured wire', () => {
  const items = capture.notifications.map((notification) =>
    normalizeCodexNotification(notification as Parameters<typeof normalizeCodexNotification>[0]))
  const tools = items.flat().flatMap((event) => (event.type === 'tool' ? [event.tool] : []))

  it('reports nothing web-shaped while the call has said nothing', () => {
    // Every item/started carries an empty query and two nulls. A payload here would be an empty
    // search that the completion then has to undo.
    expect(tools[0]).toEqual({ id: tools[0].id, title: 'Web search', kind: 'search', status: 'running' })
  })

  it('keeps the query, the action and the sources of a search', () => {
    expect(tools[1]).toMatchObject({
      title: 'Search web',
      status: 'completed',
      web: { action: { type: 'search', queries: ['Agent Client Protocol acp specification'] } },
    })
    expect(tools[1].web?.results?.[0]).toEqual({
      url: 'https://github.com/agent-control-protocol/acp/blob/main/spec/SPEC.md',
      title: 'acp/spec/SPEC.md at main · agent-control-protocol/acp · GitHub',
      domain: 'github.com',
      snippet: expect.stringContaining('Agent Control Protocol'),
    })
  })

  it('carries the sources of an unnamed action without inventing a query for it', () => {
    // The same model reading a page, which this CLI reported as `other` with an empty query.
    expect(tools[3]).toMatchObject({ title: 'Web activity', web: { action: { type: 'other' } } })
    expect(tools[3].web?.results).toHaveLength(1)
  })

  it('names a page open after the page rather than after a search', () => {
    expect(tools[5]).toMatchObject({
      title: 'Open page',
      web: { action: { type: 'open_page', url: 'https://agentclientprotocol.com/protocol/overview' } },
    })
  })

  it('drops the fields a ledger has no use for', () => {
    // `ref_id`, `type` and `thumbnail_url` are all on the captured rows. A thumbnail in particular is
    // a fetch this card refuses to make.
    expect(Object.keys(tools[5].web?.results?.[0] ?? {}).sort())
      .toEqual(['domain', 'snippet', 'title', 'url'])
  })
})

describe('Codex web activity, unit cases', () => {
  const webTool = (item: Record<string, unknown>, method = 'item/completed') => {
    const [event] = normalizeCodexNotification({ method, params: { item: { type: 'webSearch', ...item } } })
    if (event?.type !== 'tool') throw new Error('expected a tool event')
    return event.tool
  }

  it('prefers the action’s list of queries, in order and without repeats', () => {
    expect(webTool({
      id: 'w1',
      query: 'ignored',
      action: { type: 'search', query: 'also ignored', queries: ['first', 'second', 'first'] },
    }).web?.action).toEqual({ type: 'search', queries: ['first', 'second'] })
  })

  it('falls back to the action’s single query, then to the item’s own', () => {
    expect(webTool({ id: 'w1', query: 'from the item', action: { type: 'search', query: 'from the action', queries: null } })
      .web?.action).toEqual({ type: 'search', queries: ['from the action'] })
    expect(webTool({ id: 'w1', query: 'from the item', action: { type: 'search', query: null, queries: [] } })
      .web?.action).toEqual({ type: 'search', queries: ['from the item'] })
  })

  it('reads a find-in-page action, which the schema declares and no run produced', () => {
    // Written from `codex app-server generate-json-schema --experimental`, WebSearchAction, rather
    // than from a capture: neither live run chose this action.
    expect(webTool({
      id: 'w1',
      query: '',
      action: { type: 'findInPage', url: 'https://example.com/page', pattern: 'session' },
    })).toMatchObject({
      title: 'Find on page',
      web: { action: { type: 'find_in_page', url: 'https://example.com/page', pattern: 'session' } },
    })
  })

  it('treats a query with no action at all as the search it plainly is', () => {
    expect(webTool({ id: 'w1', query: 'standalone', action: null }).web?.action)
      .toEqual({ type: 'search', queries: ['standalone'] })
  })

  it('reads past a result row that is malformed, rather than past the whole set', () => {
    // Codex types each row as opaque JSON on purpose, so a row with no URL is a row this card cannot
    // draw, not a reason to lose the ones beside it.
    expect(webTool({
      id: 'w1',
      query: 'q',
      action: { type: 'search', query: 'q', queries: null },
      results: [null, 'text', { title: 'no url' }, { url: 'https://example.com', title: 42 }],
    }).web?.results).toEqual([{ url: 'https://example.com', title: undefined, domain: undefined, snippet: undefined }])
  })

  it('keeps a failed call’s query and says it failed', () => {
    expect(webTool({
      id: 'w1',
      query: 'q',
      status: 'failed',
      action: { type: 'search', query: 'q', queries: null },
    })).toMatchObject({ status: 'failed', web: { action: { type: 'search', queries: ['q'] } } })
  })
})
