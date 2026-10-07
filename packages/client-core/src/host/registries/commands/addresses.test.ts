import { describe, expect, it } from 'vitest'
import { buildLink, MAX_LINK_LENGTH, parseLink, type Place } from './addresses'

describe('Acorn addresses', () => {
  it.each<[string, Place]>([
    ['acorn://node-a/t/task%201?pane=linear&item=ENG-1', { kind: 'task', taskId: 'task 1', pane: 'linear', item: 'ENG-1' }],
    ['acorn://node-a/p/project%2Fone/x/example/item%201', { kind: 'project', projectId: 'project/one', rest: ['x', 'example', 'item 1'] }],
    ['acorn://node-a/settings/agents#general', { kind: 'settings', pageId: 'agents', sectionId: 'general' }],
    ['acorn://node-a/source/pulls', { kind: 'source', sourceId: 'pulls' }],
    ['acorn://node-a/open?url=https%3A%2F%2Fexample.com%2Fa%3Fq%3D1', { kind: 'open', url: 'https://example.com/a?q=1' }],
    ['acorn://node-a/new-task?url=http%3A%2F%2Fexample.com%2Fitem', { kind: 'new-task', url: 'http://example.com/item' }],
  ])('parses %s', (href, place) => {
    expect(parseLink(href)).toEqual({ kind: 'address', address: { nodeId: 'node-a', ...place } })
  })

  it.each<Place>([
    { kind: 'task', taskId: 'task/one', pane: 'linear', item: 'ENG 1' },
    { kind: 'project', projectId: 'project/one', rest: ['x', 'plugin-id', 'item 1'] },
    { kind: 'settings', pageId: 'agents', sectionId: 'general' },
    { kind: 'source', sourceId: 'pulls' },
  ])('round trips $kind', (place) => {
    if (place.kind === 'open' || place.kind === 'new-task') return
    expect(parseLink(buildLink('node-a', place))).toEqual({ kind: 'address', address: { nodeId: 'node-a', ...place } })
  })

  it.each([
    'https://node-a/t/task',
    'acorn:///t/task',
    'acorn://NODE-A/t/task',
    'acorn://node-a/unknown/item',
    'acorn://node-a/t/%GG',
    'acorn://node-a/t/task?pane=linear',
    'acorn://node-a/t/task?pane=a&pane=b&item=c',
    'acorn://node-a/open?url=javascript%3Aalert(1)',
    'acorn://node-a/open?url=file%3A%2F%2F%2Ftmp%2Fa',
    'acorn://node-a/p/project?unwanted=1',
    `acorn://node-a/t/${'x'.repeat(MAX_LINK_LENGTH)}`,
  ])('refuses unsafe or malformed %s', (href) => {
    expect(parseLink(href)).toMatchObject({ kind: 'refused', link: href })
  })
})
