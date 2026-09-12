// The exclusive-slot registry: a plugin offers to stand in for one of core's own surfaces, and the
// user decides whether it does (docs/plugins.md § Replacing a core surface).
//
// No JSX import here (docs/frontend.md § Registries and plugins), so the arbitration rule can be
// tested. The host that draws the resolved surface lives in a `.tsx`.
import type { Component } from 'solid-js'
import { CORE_SLOT_PROVIDER, isCoreExclusiveSlot, type CoreExclusiveSlot } from '@acorn/protocol/extensionPoints.ts'
import { Registry } from '../../../kit/lib/registry'

export type { CoreExclusiveSlot }
export { CORE_SLOT_PROVIDER }

export type ExclusiveSlotProvider = {
  /** `plugin:<pluginId>:<surfaceId>`, no core contribution id contains a colon, the same namespacing a
   *  plugin theme and a plugin context-menu row take. */
  id: string
  /** Stamped by the host from the manifest it read. This is the value the user's arbitration stores,
   *  so a descriptor that could state it would be a descriptor that could impersonate another
   *  package. */
  pluginId: string
  slot: CoreExclusiveSlot
  label: string
  /** Is the offering plugin running on the node being looked at? */
  when?: () => boolean
  component: Component
}

export const exclusiveSlotRegistry = new Registry<ExclusiveSlotProvider>('exclusive-slot')

// Providers whose surface threw while rendering, keyed `<slot>:<pluginId>`. A module-level set rather
// than a signal, because the host that catches the throw and the resolver that stops choosing it sit
// in different modules, and the fall back to core has to survive an error boundary's reset.
const failed = new Set<string>()

/** Called by the host's error boundary. Idempotent, and permanent until the plugin set is re-synced,
 *  because retrying a broken replacement on every render flickers between two task lists. */
export const noteExclusiveSlotFailure = (slot: CoreExclusiveSlot, pluginId: string): void =>
  void failed.add(`${slot}:${pluginId}`)

export const exclusiveSlotFailed = (slot: CoreExclusiveSlot, pluginId: string): boolean =>
  failed.has(`${slot}:${pluginId}`)

/** Cleared by the contribution sync, which is the one moment the bytes behind a provider can have
 *  changed. Also the test seam. */
export const clearExclusiveSlotFailures = (): void => failed.clear()

/** Every plugin offering to replace this surface, for the settings picker. These are offers, so
 *  nothing here is on screen unless the user said so. */
export const exclusiveSlotOffers = (slot: CoreExclusiveSlot): ExclusiveSlotProvider[] =>
  exclusiveSlotRegistry.entries()
    .filter((entry) => entry.slot === slot && (entry.when?.() ?? true))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId))

/**
/**
 * Who draws this surface: a provider, or `null` meaning core (docs/plugins.md § Replacing a core
 * surface).
 *
 * `choice` is what the user picked. Every path that is not "this exact plugin is here, eligible and
 * has not thrown" returns null, so the caller has one branch.
 */
export function resolveExclusiveSlot(
  slot: CoreExclusiveSlot,
  choice: string | undefined,
): ExclusiveSlotProvider | null {
  if (!choice || choice === CORE_SLOT_PROVIDER) return null
  if (exclusiveSlotFailed(slot, choice)) return null
  return exclusiveSlotOffers(slot).find((entry) => entry.pluginId === choice) ?? null
}

/**
/**
 * The stored arbitration, read out of the one preference that holds all of it.
 *
 * One key holding a `{ slot: pluginId }` map rather than a key per slot, like `disk_warning_acked`.
 * The designated list is short, and a key per member would need a registration and an eviction rule
 * for a value that is one string.
 *
 * Anything unparseable reads as "nothing chosen", which is core. A malformed preference must not be
 * able to take someone's task list away.
 */
export function exclusiveSlotChoices(raw: string | undefined): Partial<Record<CoreExclusiveSlot, string>> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Partial<Record<CoreExclusiveSlot, string>> = {}
    for (const [slot, value] of Object.entries(parsed)) {
      // A slot this shell does not have is dropped. The list is version vocabulary, so a stored choice
      // for a slot that no longer exists is not something this device can honour.
      if (isCoreExclusiveSlot(slot) && typeof value === 'string' && value) out[slot] = value
    }
    return out
  } catch {
    return {}
  }
}

/** The inverse, for the settings picker's write. Choosing core removes the entry rather than storing
 *  the sentinel, so the preference holds only the replacements the owner actually asked for. */
export function withExclusiveSlotChoice(
  raw: string | undefined,
  slot: CoreExclusiveSlot,
  choice: string,
): string {
  const next = exclusiveSlotChoices(raw)
  if (choice === CORE_SLOT_PROVIDER) delete next[slot]
  else next[slot] = choice
  return JSON.stringify(next)
}
