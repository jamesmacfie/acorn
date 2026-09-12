import { afterEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext } from '../../testkit/pluginContext'
import { clearRegistrations } from './host'
import { extensionPointId } from './extensionPoints'

// The node's many-to-many seam, exercised through the real context builder rather than the registry
// module: the owner binding is the part worth testing, and a plugin only ever sees the bound version.
const POINT = extensionPointId<string>('owner:things')

const context = (name: string) => makeTestNodeContext({ plugin: { name } })

describe('node extension points', () => {
  afterEach(() => {
    for (const name of ['owner', 'other', 'thief']) clearRegistrations(name)
  })

  it('refuses a point outside the opening plugin\'s namespace', () => {
    const thief = context('thief')
    try {
      expect(() => thief.extensionPoints.declare(POINT, 'Things')).toThrow(/only open points under 'thief:'/)
    } finally {
      thief.cleanup()
    }
  })

  it('still answers to the names it carried before 2026-08-31', () => {
    // `open`, `contribute` and `entries` are deprecated aliases for one major, so a plugin outside this
    // repository moves on its own schedule (docs/plugins.md § The plugin API). One test rather than a
    // second copy of the suite: the aliases share their implementations with the new names, so what is
    // worth proving is that all three are wired and reach the same registry.
    const owner = context('owner')
    const other = context('other')
    try {
      owner.extensionPoints.open(POINT, 'Things')
      other.extensionPoints.contribute(POINT, { id: 'thing', value: 'a' })
      expect(owner.extensionPoints.entries(POINT).map((entry) => entry.id)).toEqual(['other:thing'])
      // And the two spellings are one registry, not two.
      expect(owner.extensionPoints.handlers(POINT).map((entry) => entry.id)).toEqual(['other:thing'])
    } finally {
      owner.cleanup()
      other.cleanup()
    }
  })

  it('delivers other plugins\' entries in order, under host-minted ids', () => {
    const owner = context('owner')
    const other = context('other')
    try {
      owner.extensionPoints.declare(POINT, 'Things')
      other.extensionPoints.handle(POINT, { id: 'late', order: 10, value: 'b' })
      // The owner may fill its own point, and both plugins may call their entry the same thing.
      owner.extensionPoints.handle(POINT, { id: 'late', order: 1, value: 'a' })
      expect(owner.extensionPoints.handlers(POINT).map((entry) => [entry.id, entry.value])).toEqual([
        ['owner:late', 'a'],
        ['other:late', 'b'],
      ])
    } finally {
      owner.cleanup()
      other.cleanup()
    }
  })

  it('refuses one plugin filing the same entry id twice, and reads nothing from an unopened point', () => {
    const other = context('other')
    try {
      other.extensionPoints.handle(POINT, { id: 'thing', value: 'a' })
      expect(() => other.extensionPoints.handle(POINT, { id: 'thing', value: 'b' })).toThrow(/Duplicate extension/)
      // Nobody has opened `owner:things` in this test, so there is no owner to hand the entry to.
      expect(other.extensionPoints.handlers(POINT)).toEqual([])
    } finally {
      other.cleanup()
    }
  })

  it('takes back both halves when a plugin goes', () => {
    const owner = context('owner')
    const other = context('other')
    try {
      owner.extensionPoints.declare(POINT, 'Things')
      other.extensionPoints.handle(POINT, { id: 'thing', value: 'a' })
      clearRegistrations('other')
      expect(owner.extensionPoints.handlers(POINT)).toEqual([])
      // And the point itself goes with its owner, so a survivor cannot deliver into a plugin that
      // is no longer running.
      other.extensionPoints.handle(POINT, { id: 'thing', value: 'a' })
      clearRegistrations('owner')
      expect(other.extensionPoints.handlers(POINT)).toEqual([])
    } finally {
      owner.cleanup()
      other.cleanup()
    }
  })
})
