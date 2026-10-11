import { describe, expect, it } from 'vitest'
import {
  CONTEXT_MENU_FACTS,
  CONTEXT_MENU_LOCATIONS,
  fileExtensionFact,
  isContextMenuLocation,
  isRailMenuLocation,
  matchesWhen,
  unknownWhenFacts,
} from './contextMenus.ts'

// The half of the context-menu contract both sides read: the node checks a manifest against it, the
// client re-checks a roster row against it, and a plugin's `when` is evaluated by it. Small enough to
// state completely, which is the whole argument for the map form over an expression.

describe('the location vocabulary', () => {
  it('has a fact list for every location it names', () => {
    // A location with no fact list would make every `when` on it a parse error with a confusing
    // message, and the lookup below would be undefined at runtime.
    for (const location of CONTEXT_MENU_LOCATIONS) {
      expect(CONTEXT_MENU_FACTS[location], location).toBeDefined()
      expect(CONTEXT_MENU_FACTS[location].length, location).toBeGreaterThan(0)
    }
    expect(Object.keys(CONTEXT_MENU_FACTS).sort()).toEqual([...CONTEXT_MENU_LOCATIONS].sort())
  })

  it('recognises only the locations it declares', () => {
    expect(isContextMenuLocation('task.row')).toBe(true)
    expect(isContextMenuLocation('file.row')).toBe(true)
    expect(isContextMenuLocation('document.tab')).toBe(true)
    expect(isContextMenuLocation('agent.message')).toBe(true)
    expect(isContextMenuLocation('agent.turn')).toBe(true)
    expect(isContextMenuLocation('content.selection')).toBe(true)
    for (const value of ['task.footer', 'task.row ', 'TASK.ROW', '', null, undefined, 42, {}]) {
      expect(isContextMenuLocation(value), String(value)).toBe(false)
    }
  })

  it('keeps identity fields out of the fact list', () => {
    // `id` and `title` are the action's payload. A `when` keyed to one task id is not an extension
    // point, and letting a manifest name them would read as though it were.
    for (const fact of ['id', 'title', 'location']) {
      expect(CONTEXT_MENU_FACTS['task.row'], fact).not.toContain(fact)
    }
    // A file's identity is its path, and its revision changes on every save. Neither is something a
    // manifest should match, and neither are the bound Node and task.
    for (const location of ['file.row', 'document.tab'] as const) {
      for (const fact of ['path', 'title', 'revision', 'nodeId', 'taskId', 'ownerPluginId']) {
        expect(CONTEXT_MENU_FACTS[location], `${location} ${fact}`).not.toContain(fact)
      }
    }
    // A message's text and ids are what the action receives; matching on text would be a trap.
    for (const location of ['agent.message', 'agent.turn'] as const) {
      for (const fact of ['text', 'textTruncated', 'itemId', 'turnId', 'sessionId', 'revision', 'nodeId', 'taskId']) {
        expect(CONTEXT_MENU_FACTS[location], `${location} ${fact}`).not.toContain(fact)
      }
    }
    // A selection is matched on what kind of content it is, never on the text or where it came from.
    for (const fact of ['text', 'ownerId', 'revision', 'range', 'resource', 'projectId', 'taskId', 'nodeId']) {
      expect(CONTEXT_MENU_FACTS['content.selection'], fact).not.toContain(fact)
    }
  })

  it('keeps the file locations off the rail ownership rule', () => {
    // A file action may come from any plugin, like an `item.row` one, so it names no owned surface.
    expect(isRailMenuLocation('file.row')).toBe(false)
    expect(isRailMenuLocation('document.tab')).toBe(false)
    expect(isRailMenuLocation('agent.message')).toBe(false)
    expect(isRailMenuLocation('rail.source')).toBe(true)
    expect(isRailMenuLocation('rail.pane')).toBe(true)
  })
})

describe('fileExtensionFact', () => {
  it('is the lowercased text after the last dot of the basename', () => {
    expect(fileExtensionFact('src/data.JSON', false)).toBe('json')
    expect(fileExtensionFact('archive.tar.gz', false)).toBe('gz')
    expect(fileExtensionFact('a.b/readme', false)).toBe('')
  })

  it('is empty for a folder, a dotfile, and a name with no dot', () => {
    expect(fileExtensionFact('fixtures.json', true)).toBe('')
    expect(fileExtensionFact('.gitignore', false)).toBe('')
    expect(fileExtensionFact('Makefile', false)).toBe('')
  })
})

describe('unknownWhenFacts', () => {
  it('accepts every declared fact and names every undeclared one', () => {
    expect(unknownWhenFacts('task.row', { origin: 'github', pinned: true, projectId: 'p1' })).toEqual([])
    expect(unknownWhenFacts('task.row', {})).toEqual([])
    // Reported rather than ignored: a predicate naming a fact the host never supplies can never match,
    // so the contribution would install and silently do nothing.
    expect(unknownWhenFacts('task.row', { branch: 'main', title: 'x' })).toEqual(['branch', 'title'])
    expect(
      unknownWhenFacts('file.row', { extension: 'json', directory: false, readOnly: false, projectId: 'p1' }),
    ).toEqual([])
    expect(unknownWhenFacts('document.tab', { path: 'a.json', revision: 'abc' })).toEqual(['path', 'revision'])
    expect(unknownWhenFacts('agent.message', { role: 'assistant', status: 'completed', projectId: 'p1' })).toEqual([])
    expect(unknownWhenFacts('agent.turn', { status: 'completed', role: 'user', text: 'hi' })).toEqual(['role', 'text'])
    expect(
      unknownWhenFacts('content.selection', { contentKind: 'code', languageId: 'typescript', readOnly: true }),
    ).toEqual([])
    expect(unknownWhenFacts('content.selection', { text: 'x', ownerId: 'editor' })).toEqual(['text', 'ownerId'])
  })
})

describe('matchesWhen', () => {
  const target = { location: 'task.row', id: 't1', title: 'Ship it', origin: 'github', projectId: 'p1', pinned: false }

  it('treats an absent or empty predicate as always', () => {
    expect(matchesWhen(undefined, target)).toBe(true)
    expect(matchesWhen({}, target)).toBe(true)
  })

  it('requires every named fact to match, not any of them', () => {
    expect(matchesWhen({ origin: 'github' }, target)).toBe(true)
    expect(matchesWhen({ origin: 'github', pinned: false }, target)).toBe(true)
    expect(matchesWhen({ origin: 'github', pinned: true }, target)).toBe(false)
    expect(matchesWhen({ origin: 'local' }, target)).toBe(false)
  })

  it('compares strictly, so a string never satisfies a boolean fact', () => {
    // The reason the manifest types a value as `string | boolean` rather than `unknown`: `'false'` is
    // truthy, and a loose comparison would make `pinned: 'false'` match a pinned row.
    expect(matchesWhen({ pinned: 'false' as unknown as boolean }, target)).toBe(false)
    expect(matchesWhen({ pinned: false }, target)).toBe(true)
    expect(matchesWhen({ pinned: false }, { ...target, pinned: true })).toBe(false)
  })

  it('does not match a fact the target does not carry', () => {
    expect(matchesWhen({ nothing: 'here' }, target)).toBe(false)
  })
})
