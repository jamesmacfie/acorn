import { describe, expect, it } from 'vitest'
import { buildLink, MAX_AT_LENGTH, MAX_LINK_LENGTH, parseLink, type Place } from './addresses'

describe('Acorn addresses', () => {
  it.each<[string, Place]>([
    [
      'acorn://node-a/t/task%201?pane=linear&item=ENG-1',
      { kind: 'task', taskId: 'task 1', pane: 'linear', item: 'ENG-1' },
    ],
    ['acorn://node-a/t/task%2Fone?pane=linear', { kind: 'task', taskId: 'task/one', pane: 'linear' }],
    [
      'acorn://node-a/t/task?pane=agents&item=session-1&at=42',
      { kind: 'task', taskId: 'task', pane: 'agents', item: 'session-1', at: '42' },
    ],
    [
      'acorn://node-a/t/task?pane=agents&item=s&at=%252F',
      { kind: 'task', taskId: 'task', pane: 'agents', item: 's', at: '%2F' },
    ],
    ['acorn://node-a/t/task?pane=notes&item=%25', { kind: 'task', taskId: 'task', pane: 'notes', item: '%' }],
    ['acorn://node-a/t/task?pane=notes&item=%252F', { kind: 'task', taskId: 'task', pane: 'notes', item: '%2F' }],
    [
      'acorn://node-a/p/project%2Fone/x/example/item%201',
      { kind: 'project', projectId: 'project/one', rest: ['x', 'example', 'item 1'] },
    ],
    ['acorn://node-a/settings/agents#general', { kind: 'settings', pageId: 'agents', sectionId: 'general' }],
    ['acorn://node-a/source/pulls', { kind: 'source', sourceId: 'pulls' }],
    [
      'acorn://node-a/open?url=https%3A%2F%2Fexample.com%2Fa%3Fq%3D1',
      { kind: 'open', url: 'https://example.com/a?q=1' },
    ],
    [
      'acorn://node-a/new-task?url=http%3A%2F%2Fexample.com%2Fitem',
      { kind: 'new-task', url: 'http://example.com/item' },
    ],
  ])('parses %s', (href, place) => {
    expect(parseLink(href)).toEqual({ kind: 'address', address: { nodeId: 'node-a', ...place } })
  })

  it.each<Place>([
    { kind: 'task', taskId: 'task/one', pane: 'linear', item: 'ENG 1' },
    { kind: 'task', taskId: 'task/one', pane: 'linear' },
    { kind: 'task', taskId: 'task', pane: 'agents', item: 'session 1', at: 'a&b=c' },
    { kind: 'project', projectId: 'project/one', rest: ['x', 'plugin-id', 'item 1'] },
    { kind: 'settings', pageId: 'agents', sectionId: 'general' },
    { kind: 'source', sourceId: 'pulls' },
    { kind: 'open', url: 'https://example.com/a b?q=1+2&r=%2F#top' },
  ])('round trips $kind', (place) => {
    if (place.kind === 'new-task') return
    expect(parseLink(buildLink('node-a', place))).toEqual({ kind: 'address', address: { nodeId: 'node-a', ...place } })
  })

  it.each([
    'https://node-a/t/task',
    'acorn:///t/task',
    'acorn://NODE-A/t/task',
    'acorn://node-a/unknown/item',
    'acorn://node-a/t/%GG',
    'acorn://node-a/t/task?item=ENG-1',
    'acorn://node-a/t/task?pane=',
    'acorn://node-a/t/task?pane=notes&item=',
    'acorn://node-a/t/task?pane=a&pane=b&item=c',
    'acorn://node-a/t/task?pane=agents&at=42',
    'acorn://node-a/t/task?at=42',
    'acorn://node-a/t/task?pane=agents&item=s&at=',
    'acorn://node-a/t/task?pane=agents&item=s&at=1&at=2',
    'acorn://node-a/t/task?pane=agents&item=s&at=%GG',
    `acorn://node-a/t/task?pane=agents&item=s&at=${'x'.repeat(MAX_AT_LENGTH + 1)}`,
    'acorn://node-a/t/task?pane=%GG',
    'acorn://node-a/t/task?pane=%E0%A4',
    'acorn://node-a/t/task?%GG=value',
    'acorn://node-a/open?url=https%3A%2F%2Fexample.com%2F%GG',
    'acorn://node-a/p/project/../other',
    'acorn://node-a/p/project/%2e%2e/other',
    'acorn://node-a/p/project/%2E/other',
    'acorn://node-a/p/project/%2e%2E/other',
    'acorn://node-a/p/project/%GG',
    'acorn://node-a/open?url=javascript%3Aalert(1)',
    'acorn://node-a/open?url=file%3A%2F%2F%2Ftmp%2Fa',
    'acorn://node-a/p/project?unwanted=1',
    `acorn://node-a/t/${'x'.repeat(MAX_LINK_LENGTH)}`,
  ])('refuses unsafe or malformed %s', (href) => {
    expect(parseLink(href)).toMatchObject({ kind: 'refused', link: href })
  })

  it('builds only links the parser accepts under the length cap', () => {
    const prefix = 'acorn://node-a/t/'
    const largest = buildLink('node-a', { kind: 'task', taskId: 'x'.repeat(MAX_LINK_LENGTH - prefix.length) })
    expect(largest).toHaveLength(MAX_LINK_LENGTH)
    expect(parseLink(largest)).toMatchObject({ kind: 'address' })
    expect(() =>
      buildLink('node-a', { kind: 'task', taskId: 'x'.repeat(MAX_LINK_LENGTH - prefix.length + 1) }),
    ).toThrow(`Acorn link exceeds ${MAX_LINK_LENGTH} characters`)
    expect(() => buildLink('node-a', { kind: 'task', taskId: 'task', item: 'item' })).toThrow('needs a pane')
    expect(() => buildLink('node-a', { kind: 'task', taskId: 'task', pane: 'agents', at: '1' })).toThrow(
      'needs an item',
    )
    const at = 'x'.repeat(MAX_AT_LENGTH)
    expect(parseLink(buildLink('node-a', { kind: 'task', taskId: 't', pane: 'p', item: 'i', at }))).toMatchObject({
      address: { at },
    })
    expect(() => buildLink('node-a', { kind: 'task', taskId: 't', pane: 'p', item: 'i', at: `${at}x` })).toThrow(
      `exceeds ${MAX_AT_LENGTH} characters`,
    )
    expect(() => buildLink('node-a', { kind: 'open', url: 'javascript:alert(1)' })).toThrow('http or https')
  })
})
