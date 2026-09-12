import { describe, expect, it } from 'vitest'
import { MAX_COMMAND_SEARCH_ITEMS } from '@acorn/protocol/commands.ts'
import { importedRequestName, savedRequestSearchItems, savedRequestSearchScore, type SavedRequestSummary } from './paletteSearch'

// The ranking and the import's name, as pure functions. The route beside them is scope and ownership;
// this is what a typed word means and what an unnamed command line is called.

const row = (over: Partial<SavedRequestSummary> = {}): SavedRequestSummary => ({
  id: 'r1',
  name: 'List items',
  folder: 'items',
  method: 'GET',
  ...over,
})

describe('scoring one saved request', () => {
  it('ranks an exact name over a prefix, a prefix over a substring, a folder over a method', () => {
    const rank = (over: Partial<SavedRequestSummary>, text: string) => savedRequestSearchScore(row(over), text)
    expect(rank({ name: 'items' }, 'items')).toBe(4)
    expect(rank({ name: 'items by id' }, 'items')).toBe(3)
    expect(rank({ name: 'list items' }, 'items')).toBe(2)
    expect(rank({ name: 'x', folder: 'items' }, 'items')).toBe(1)
    expect(rank({ name: 'x', folder: 'y', method: 'POST' }, 'post')).toBe(0)
  })

  it('answers null for a word the row does not carry, and keeps every row for an empty one', () => {
    expect(savedRequestSearchScore(row(), 'invoices')).toBeNull()
    expect(savedRequestSearchScore(row(), '  ')).toBe(0)
  })
})

describe('the rows a search answers with', () => {
  it('carries a name, a folder and a method, and nothing that could be a secret', () => {
    const [item] = savedRequestSearchItems([row()], '')
    expect(item).toEqual({ id: 'r1', title: 'List items', subtitle: 'items', badge: 'GET', icon: 'send' })
    // Stated as a property rather than as a spelling: the summary this file works from has no field
    // for a URL, a header, a body, an auth block or a variable, so no row can carry one.
    expect(Object.keys(item)).not.toContain('url')
  })

  it('leaves the subtitle off an unfiled request rather than showing an empty line', () => {
    const [item] = savedRequestSearchItems([row({ folder: '' })], '')
    expect(item.subtitle).toBeUndefined()
  })

  it('sorts by tier and keeps the incoming order inside one, which is the rail’s own order', () => {
    const items = savedRequestSearchItems([
      row({ id: 'a', name: 'Alpha items' }),
      row({ id: 'b', name: 'items' }),
      row({ id: 'c', name: 'Beta items' }),
    ], 'items')
    expect(items.map((item) => item.id)).toEqual(['b', 'a', 'c'])
  })

  it('caps the answer at what the host would render anyway', () => {
    const many = Array.from({ length: MAX_COMMAND_SEARCH_ITEMS + 20 }, (_, at) => row({ id: `r${at}` }))
    expect(savedRequestSearchItems(many, '')).toHaveLength(MAX_COMMAND_SEARCH_ITEMS)
  })
})

describe('naming an imported curl command', () => {
  it('takes the endpoint a person would call it, with the method in front', () => {
    expect(importedRequestName('POST', 'https://api.example.test/v1/orders')).toBe('POST orders')
    expect(importedRequestName('GET', 'https://api.example.test/v1/orders?since=1')).toBe('GET orders')
  })

  it('skips a template segment, because `{{BASE_URL}}` is not what anybody calls the request', () => {
    expect(importedRequestName('GET', '{{BASE_URL}}/users')).toBe('GET users')
    expect(importedRequestName('GET', '{{BASE_URL}}')).toBe('GET {{BASE_URL}}')
  })

  it('falls back to the host when there is no path, and stays inside the stored bound', () => {
    expect(importedRequestName('GET', 'https://api.example.test')).toBe('GET api.example.test')
    expect(importedRequestName('GET', `https://x/${'a'.repeat(400)}`)).toHaveLength(200)
  })
})
