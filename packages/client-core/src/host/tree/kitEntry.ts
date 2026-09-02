// What a host's kit table is allowed to hold, and how a tree host turns one entry into something it
// can mount (docs/plugins.md § The tree contract).
//
// A string-keyed table from a name to code is a registry, and a registry that holds values pulls
// every value into whichever chunk holds the table. That is how a diff viewer and a syntax
// highlighter ended up in the renderer's first paint: nothing drew them, but `RemoteTree` is the
// fallback branch of ./Slot.tsx, so the table was preloaded whether or not a loaded plugin existed
// (docs/future/performance/decisions.md § Registries hold loaders).
//
// So an entry is either the component or a loader for it. Cheap primitives stay components — a
// `Button` behind a dynamic import would cost a frame for nothing — and the heavy names, the ones
// that reach a feature or a highlighter, are loaders.
//
// Deliberately not `lazy()` in the table itself: `lazy` is called here, once per entry, so a tree
// with fifty `DiffLine`s creates one lazy component rather than fifty, each with its own load state.
import { lazy, type Component } from 'solid-js'
import type { KitNodeName } from '@acorn/protocol/tree/nodes.ts'

// `Component<any>` and not a union of every node's props: the renderer has already validated the
// props against the wire schema, and a union of every node's prop type would make every mount site an
// unresolvable overload. The typing that matters is the key set, which is exhaustive.
// oxlint-disable-next-line no-explicit-any
export type AnyKitComponent = Component<any>

/** One kit node, as the component or as the import that fetches it. */
export type KitEntry = AnyKitComponent | { load: () => Promise<{ default: AnyKitComponent }> }

/** A host's whole kit, keyed by the name a tree puts on the wire. Exhaustive by type: a node in the
 *  kit but not in a host's table is a build error, and `tools/arch/kitTable.test.ts` holds the two
 *  hosts' tables to the same names. */
export type KitTable = Record<KitNodeName, KitEntry>

// Keyed on the entry rather than on the name, so one cache serves every host's table without either
// having to pass its own around. The entries are module-level literals, so the identity is stable for
// the life of the process.
const loaded = new Map<object, AnyKitComponent>()

/**
 * The component for one kit entry, memoized.
 *
 * A component comes straight back. A loader becomes a `lazy()` the first time it is asked for and the
 * same one every time after, which is what makes the caching claim above true.
 */
export function kitComponent(entry: KitEntry | undefined): AnyKitComponent | undefined {
  if (!entry) return undefined
  if (typeof entry === 'function') return entry
  const held = loaded.get(entry)
  if (held) return held
  const made = lazy(entry.load)
  loaded.set(entry, made)
  return made
}
