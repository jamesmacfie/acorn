import { describe, expect, it } from 'vitest'
import {
  acceptCommandSearchItems,
  commandInputResultSchema,
  commandSearchItemSchema,
  commandSettingOptionSchema,
  commandSettingValueSchema,
  COMMAND_KINDS,
  COMMAND_SCOPES,
  DEFAULT_COMMAND_SCOPE,
  MAX_COMMAND_SEARCH_ITEMS,
} from './commands'

// The wire half of the command contract. What is worth pinning is the boundary this module exists to
// hold: a search response is bytes a plugin's own route sent, and the one thing it must never be able
// to do is choose what happens when a row is picked.

const item = (over: Record<string, unknown> = {}) => ({ id: 'i-1', title: 'Issue one', ...over })

describe('the command vocabulary', () => {
  it('names the five kinds and the six scopes, and defaults scope to the active node', () => {
    expect([...COMMAND_KINDS]).toEqual(['action', 'group', 'search', 'input', 'setting'])
    expect([...COMMAND_SCOPES]).toEqual(['none', 'task', 'project', 'workspace', 'node', 'fleet'])
    expect(DEFAULT_COMMAND_SCOPE).toBe('node')
  })
})

describe('a search result row', () => {
  it('keeps display and identity facts', () => {
    const parsed = commandSearchItemSchema.parse(item({
      subtitle: 'runn/runn',
      icon: 'bug',
      badge: '12',
      taskId: 't-1',
      projectId: 'p-1',
      workspaceId: 'w-1',
      ref: 'ISS-42',
    }))
    expect(parsed).toMatchObject({ id: 'i-1', title: 'Issue one', ref: 'ISS-42', taskId: 't-1' })
  })

  it('strips anything that would let a response choose a verb', () => {
    // The refusal this module exists for. A row that ships an action, a route or a URL loses all
    // three here, before a host can read one
    // (docs/future/command-palette/refused.md § Returning executable commands from a loaded search
    // response).
    const parsed = commandSearchItemSchema.parse(item({
      action: { verb: 'runNodeAction', path: '/somewhere/else' },
      route: '/v2/core/tasks',
      url: 'https://example.test',
    }))
    expect(parsed).toEqual({ id: 'i-1', title: 'Issue one' })
  })

  it('refuses a row with no id or no title, and bounds what it will render', () => {
    expect(commandSearchItemSchema.safeParse({ title: 'no id' }).success).toBe(false)
    expect(commandSearchItemSchema.safeParse({ id: 'i-1' }).success).toBe(false)
    expect(commandSearchItemSchema.safeParse(item({ title: 'x'.repeat(301) })).success).toBe(false)
  })
})

describe('accepting a search response', () => {
  it('drops a malformed row rather than the whole answer', () => {
    const items = acceptCommandSearchItems({ items: [item(), 'not an object', item({ id: 'i-2' }), { id: 'i-3' }] })
    expect(items.map((row) => row.id)).toEqual(['i-1', 'i-2'])
  })

  it('truncates rather than refusing a long answer', () => {
    const many = Array.from({ length: MAX_COMMAND_SEARCH_ITEMS + 10 }, (_, index) => item({ id: `i-${index}` }))
    expect(acceptCommandSearchItems({ items: many })).toHaveLength(MAX_COMMAND_SEARCH_ITEMS)
  })

  it('reads nothing out of a response that is not one', () => {
    expect(acceptCommandSearchItems(null)).toEqual([])
    expect(acceptCommandSearchItems('items')).toEqual([])
    expect(acceptCommandSearchItems({ items: 'one' })).toEqual([])
    expect(acceptCommandSearchItems({})).toEqual([])
  })

  it('keeps a sibling key from costing the reader its rows', () => {
    // An older client reading a newer node's answer. The envelope is loose for the reason every other
    // descriptor response is: contributing less beats failing to parse.
    expect(acceptCommandSearchItems({ items: [item()], total: 900 })).toHaveLength(1)
  })
})

describe('the input and setting answers', () => {
  it('accepts a submit result and its optional row, and strips the row’s verbs too', () => {
    const parsed = commandInputResultSchema.parse({
      ok: true,
      message: 'Wrote the query',
      item: item({ ref: 'q-1', action: { verb: 'openUrl', url: 'https://example.test' } }),
    })
    expect(parsed.item).toEqual({ id: 'i-1', title: 'Issue one', ref: 'q-1' })
  })

  it('has no `ok: false`, because a failure is the ordinary error envelope', () => {
    expect(commandInputResultSchema.safeParse({ ok: false }).success).toBe(false)
  })

  it('reads a setting value and a declared option', () => {
    expect(commandSettingValueSchema.parse({ value: 'dark' })).toEqual({ value: 'dark' })
    expect(commandSettingValueSchema.safeParse({ value: '' }).success).toBe(false)
    expect(commandSettingOptionSchema.parse({ value: 'dark', label: 'Dark' })).toEqual({ value: 'dark', label: 'Dark' })
    expect(commandSettingOptionSchema.safeParse({ value: 'dark' }).success).toBe(false)
  })
})
