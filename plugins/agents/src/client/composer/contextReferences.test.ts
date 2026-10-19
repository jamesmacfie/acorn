import { describe, expect, it } from 'vitest'
import type { AgentContextContribution, AgentContextSnapshot } from '@acorn/protocol/agentContext.ts'
import {
  categorySuggestions,
  contextCompletion,
  contextSlug,
  contextLinkIndex,
  insertContextToken,
  linkContextReferences,
  removeContextTokens,
  resolveContextReferences,
  type ContextCategory,
} from './contextReferences'
import { composerTokens } from './composerTokens'
import { captureReferences } from './contextOperations'

const agent: ContextCategory = {
  keyword: 'agent',
  label: 'Agent sessions',
  items: [
    { id: 's1', label: 'Refactor login (v2)' },
    { id: 's2', label: 'Fix flaky test' },
    { id: 's3', label: 'Fix flaky test' },
  ],
}
const task: ContextCategory = { keyword: 'task', label: 'Task context', itemless: true }
const categories = [agent, task]
const tokens = (text: string, map = {}) => resolveContextReferences(text, categories, map).map((ref) => ref.text)

describe('contextSlug', () => {
  it('lowercases and joins runs of anything else with one hyphen', () => {
    expect(contextSlug('Refactor login (v2)')).toBe('refactor-login-v2')
    expect(contextSlug('  --Dev  server!! ')).toBe('dev-server')
    expect(contextSlug('日本')).toBe('item')
  })
})

describe('resolveContextReferences', () => {
  it('resolves a hand-typed token whose slug names exactly one item', () => {
    expect(resolveContextReferences('compare #agent:refactor-login-v2.', categories)).toEqual([
      {
        text: '#agent:refactor-login-v2',
        keyword: 'agent',
        start: 8,
        end: 32,
        itemId: 's1',
        label: 'Refactor login (v2)',
      },
    ])
  })

  it('leaves prose alone', () => {
    for (const prose of ['#123', '# Heading', 'C#', 'a#b', '#unknown:thing', '#tasks', '#Agent:fix', 'see #agent:']) {
      expect(tokens(prose), prose).toEqual([])
    }
  })

  it('takes a bare keyword only for an itemless source', () => {
    expect(tokens('use #task and #agent')).toEqual(['#task'])
    expect(tokens('#task:anything')).toEqual([])
  })

  it('keeps two items with one slug apart through the map, and resolves neither by hand', () => {
    expect(tokens('#agent:fix-flaky-test')).toEqual([])
    const map = {
      '#agent:fix-flaky-test': { id: 's2', label: 'Fix flaky test' },
      '#agent:fix-flaky-test-2': { id: 's3', label: 'Fix flaky test' },
    }
    expect(
      resolveContextReferences('#agent:fix-flaky-test vs #agent:fix-flaky-test-2', categories, map).map(
        (ref) => ref.itemId,
      ),
    ).toEqual(['s2', 's3'])
  })

  it('resolves through the map even when the list has not been read', () => {
    const unread = [{ keyword: 'agent', label: 'Agent sessions' }]
    expect(
      resolveContextReferences('#agent:old-title', unread, { '#agent:old-title': { id: 's9', label: 'New' } }),
    ).toHaveLength(1)
  })
})

describe('contextCompletion', () => {
  it('suffixes a slug another item already holds in the draft', () => {
    expect(contextCompletion(agent, agent.items![1]!, {})).toBe('#agent:fix-flaky-test')
    const map = { '#agent:fix-flaky-test': { id: 's2', label: 'Fix flaky test' } }
    expect(contextCompletion(agent, agent.items![1]!, map)).toBe('#agent:fix-flaky-test')
    expect(contextCompletion(agent, agent.items![2]!, map)).toBe('#agent:fix-flaky-test-2')
  })
})

describe('categorySuggestions', () => {
  it('matches the start of the keyword or of a word in the label, so a number matches nothing', () => {
    expect(categorySuggestions(categories, 'ag').map((category) => category.keyword)).toEqual(['agent'])
    expect(categorySuggestions(categories, 'sess').map((category) => category.keyword)).toEqual(['agent'])
    expect(categorySuggestions(categories, '1')).toEqual([])
  })
})

describe('editing tokens', () => {
  it('inserts at the caret with a space either side', () => {
    expect(insertContextToken('see this', 3, '#task')).toEqual({ text: 'see #task this', cursor: 9 })
    expect(insertContextToken('', 0, '#task')).toEqual({ text: '#task ', cursor: 6 })
  })

  it('removes tokens and the space beside each', () => {
    const text = 'see #task and #agent:refactor-login-v2'
    expect(removeContextTokens(text, resolveContextReferences(text, categories))).toBe('see and')
  })
})

describe('colour and send', () => {
  it('attaches exactly the tokens the composer colours', async () => {
    const text = 'compare #agent:refactor-login-v2 with #agent:fix-flaky-test-2, #agent:nope and #task #123'
    const map = { '#agent:fix-flaky-test-2': { id: 's3', label: 'Fix flaky test' } }
    const coloured = composerTokens(text, {}, [], { categories, map })
      .filter((token) => token.kind === 'context')
      .map((token) => text.slice(token.start, token.end))

    const snapshot = (source: string, resourceId?: string): AgentContextSnapshot => ({
      type: 'context',
      contextId: resourceId ?? source,
      label: source,
      content: '',
      source,
      ...(resourceId ? { resourceId } : {}),
      capturedAt: 1,
    })
    const contributions: AgentContextContribution[] = [
      {
        id: 'agents',
        source: 'agents.sessions',
        keyword: 'agent',
        label: 'Agent sessions',
        options: async () => [],
        capture: async (_scope, ids) => (ids ?? []).map((id) => snapshot('agents.sessions', id)),
      },
      {
        id: 'task',
        source: 'context.task',
        keyword: 'task',
        itemless: true,
        label: 'Task context',
        options: async () => [],
        capture: async () => [snapshot('context.task')],
      },
    ]
    const sent = await captureReferences(
      { taskId: 't1' },
      resolveContextReferences(text, categories, map),
      contributions,
    )

    expect(coloured).toEqual(['#agent:refactor-login-v2', '#agent:fix-flaky-test-2', '#task'])
    expect(sent.map((context) => context.ref).sort()).toEqual([...coloured].sort())
  })

  it('stops the send and names the token when its source leaves the item out', async () => {
    const contributions: AgentContextContribution[] = [
      {
        id: 'a',
        source: 'a',
        keyword: 'agent',
        label: 'Agent sessions',
        options: async () => [],
        capture: async () => [],
      },
    ]
    await expect(
      captureReferences(
        { taskId: 't1' },
        resolveContextReferences('#agent:refactor-login-v2', categories),
        contributions,
      ),
    ).rejects.toThrow("Couldn't capture #agent:refactor-login-v2.")
  })
})

describe('linkContextReferences', () => {
  it('links the sent tokens and leaves code and unsent tokens as they were', () => {
    const text = 'see #agent:a and #task.\n`#agent:a` #agent:b\n```\n#task\n```'
    expect(linkContextReferences(text, ['#agent:a', '#task'])).toBe(
      'see [#agent:a](#context-ref-0) and [#task](#context-ref-1).\n`#agent:a` #agent:b\n```\n#task\n```',
    )
    expect(contextLinkIndex('#context-ref-1')).toBe(1)
    expect(contextLinkIndex('https://example.com/#context-ref-1')).toBeNull()
  })
})
