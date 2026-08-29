import { afterEach, describe, expect, it } from 'vitest'
import {
  matchesKey,
  slotChoiceFor,
  resolveSlot,
  slotChoiceKey,
  slotChoices,
  withSlotChoice,
} from './arbitration'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
  type ExtensionPointContribution,
} from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'

// Who fills a box when more than one contributor could (docs/plugins.md § Arbitration).
//
// The rule worth pinning is the tie: two contributors matching one key in `replace` mode draw the
// owner's default until the user picks, because a package that could take a box by registering for it
// could take one from another package by registering later. An override is an offer, not a seizure.

const registered: Disposable[] = []
afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
})

const point = (over: Partial<ExtensionPointContribution> = {}): ExtensionPointContribution => {
  const entry: ExtensionPointContribution = {
    id: 'agents:attachment',
    ownerId: 'agents',
    label: 'Attachment',
    kind: 'remote',
    mode: 'replace',
    max: 4,
    ...over,
  }
  registered.push(extensionPointRegistry.register(entry))
  return entry
}

const contributor = (pluginId: string, matches?: string[]) =>
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:draw`,
    pluginId,
    point: 'agents:attachment',
    label: `${pluginId} viewer`,
    order: 500,
    carrier: 'remote',
    entry: 'draw',
    hash: 'abc',
    ...(matches ? { matches } : {}),
  } as ExtensionContribution))

describe('matchesKey', () => {
  it('takes every key when the contributor named none', () => {
    expect(matchesKey(undefined, 'image/png')).toBe(true)
    expect(matchesKey([], undefined)).toBe(true)
  })

  it('matches exactly, on a trailing star as a prefix, and on a leading star as a suffix', () => {
    expect(matchesKey(['image/png'], 'image/png')).toBe(true)
    expect(matchesKey(['image/png'], 'image/jpeg')).toBe(false)
    expect(matchesKey(['image/*'], 'image/jpeg')).toBe(true)
    expect(matchesKey(['image/*'], 'text/csv')).toBe(false)
    expect(matchesKey(['*.md'], 'README.md')).toBe(true)
    expect(matchesKey(['*.md'], 'README.txt')).toBe(false)
  })

  it('matches nothing when the owner passed no key and the contributor named some', () => {
    // A `replace` point that forgot to pass its key would otherwise hand the box to whoever registered
    // first, which is the arbitrary answer this module exists to avoid.
    expect(matchesKey(['image/*'], undefined)).toBe(false)
  })
})

describe('resolveSlot', () => {
  it('draws the owner’s default when nobody matches', () => {
    const declared = point()
    contributor('images', ['image/*'])
    expect(resolveSlot(declared, 'text/csv', undefined)).toEqual({ occupants: [], overflow: 0, why: 'default' })
  })

  it('gives the box to a single match with nobody having to decide', () => {
    const declared = point()
    contributor('images', ['image/*'])
    const outcome = resolveSlot(declared, 'image/png', undefined)
    expect(outcome.why).toBe('match')
    expect(outcome.occupants.map((entry) => entry.pluginId)).toEqual(['images'])
  })

  it('draws the owner’s default when two match and nobody has picked', () => {
    const declared = point()
    contributor('images', ['image/*'])
    contributor('thumbs', ['image/png'])
    const outcome = resolveSlot(declared, 'image/png', undefined)
    expect(outcome).toMatchObject({ occupants: [], why: 'tie', overflow: 2 })
  })

  it('honours the user’s pick, and falls back to the default rather than to the runner-up', () => {
    const declared = point()
    contributor('images', ['image/*'])
    contributor('thumbs', ['image/png'])
    expect(resolveSlot(declared, 'image/png', 'thumbs').occupants.map((entry) => entry.pluginId)).toEqual(['thumbs'])
    // A pick naming a plugin that no longer matches. Silently promoting the other candidate would mean
    // the box changed hands because somebody uninstalled something.
    expect(resolveSlot(declared, 'image/png', 'gone')).toMatchObject({ occupants: [], why: 'tie' })
  })

  it('stacks every match up to the owner’s ceiling and counts the rest', () => {
    const declared = point({ id: 'agents:composer-actions', mode: 'stack', max: 2 })
    for (const id of ['a', 'b', 'c']) {
      registered.push(extensionRegistry.register({
        id: `plugin:${id}:draw`,
        pluginId: id,
        point: 'agents:composer-actions',
        label: id,
        order: 500,
        carrier: 'remote',
        entry: 'draw',
        hash: 'abc',
      } as ExtensionContribution))
    }
    const outcome = resolveSlot(declared, undefined, undefined)
    expect(outcome.occupants.map((entry) => entry.pluginId)).toEqual(['a', 'b'])
    expect(outcome).toMatchObject({ overflow: 1, why: 'match' })
  })
})

describe('the stored pick', () => {
  it('keys a decision by the point and the value it was made about', () => {
    // "Who draws a PNG attachment" and "who draws a CSV one" are two decisions.
    expect(slotChoiceKey('agents:attachment', 'image/png')).toBe('agents:attachment|image/png')
    expect(slotChoiceKey('agents:attachment', undefined)).toBe('agents:attachment')
  })

  it('reads anything unparseable as nothing chosen, which is the owner’s default', () => {
    expect(slotChoices(undefined)).toEqual({})
    expect(slotChoices('not json')).toEqual({})
    expect(slotChoices('["a"]')).toEqual({})
    expect(slotChoices('{"a:b":"images","a:c":7}')).toEqual({ 'a:b': 'images' })
  })

  it('takes the answer for this key first, then the one for the point as a whole', () => {
    // The settings picker writes the point-wide answer, because "who draws this slot" is the decision a
    // person is there to make. Without the fallback that decision would never reach a keyed slot.
    const choices = slotChoices('{"agents:attachment":"images","agents:attachment|text/csv":"tables"}')
    expect(slotChoiceFor(choices, 'agents:attachment', 'text/csv')).toBe('tables')
    expect(slotChoiceFor(choices, 'agents:attachment', 'image/png')).toBe('images')
    expect(slotChoiceFor(choices, 'agents:attachment', undefined)).toBe('images')
    expect(slotChoiceFor(choices, 'agents:tool-card', 'bash')).toBeUndefined()
  })

  it('removes the entry when the choice is cleared, rather than storing a sentinel', () => {
    const stored = withSlotChoice(undefined, 'a:b', 'images')
    expect(slotChoices(stored)).toEqual({ 'a:b': 'images' })
    expect(slotChoices(withSlotChoice(stored, 'a:b', ''))).toEqual({})
  })
})
