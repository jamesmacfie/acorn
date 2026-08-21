// The exclusive-slot registry: a plugin offers to stand in for one of core's own surfaces, and the
// user decides whether it does (docs/plugins.md § Replacing a core surface).
//
// This module holds no JSX import (docs/frontend.md § Registries and plugins): the arbitration rule
// is here so it can be tested; the host that draws the resolved surface lives in a `.tsx`.
import type { Component } from 'solid-js'
import { CORE_SLOT_PROVIDER, isCoreExclusiveSlot, type CoreExclusiveSlot } from '@acorn/protocol/extensionPoints.ts'
import { Registry } from './registry'

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
// than a signal, because the host that catches the throw and the resolver that stops choosing it are
// in different modules, and the fall back to core must survive the remount that an error boundary's
// reset would otherwise loop on.
const failed = new Set<string>()

/** Called by the host's error boundary. Idempotent, and permanent for this session: a surface that
 *  threw once gets no second chance until the plugin set is re-synced, because retrying a broken
 *  replacement on every render is a flicker between two task lists. */
export const noteExclusiveSlotFailure = (slot: CoreExclusiveSlot, pluginId: string): void =>
  void failed.add(`${slot}:${pluginId}`)

export const exclusiveSlotFailed = (slot: CoreExclusiveSlot, pluginId: string): boolean =>
  failed.has(`${slot}:${pluginId}`)

/** Cleared by the contribution sync, which is the one moment the bytes behind a provider can have
 *  changed. Also the test seam. */
export const clearExclusiveSlotFailures = (): void => failed.clear()

/** Every plugin currently offering to replace this surface, for the settings picker. Offers, not
 *  choices: nothing here is on screen unless the user said so. */
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
 * One key holding a `{ slot: pluginId }` map rather than a key per slot, the same shape
 * `disk_warning_acked` takes and for the same reason: the designated list is short, and a key per
 * member would need a registration and an eviction rule for a value that is one string.
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
      // A slot this shell does not have is dropped rather than kept: the list is version vocabulary,
      // and a stored choice for a slot that no longer exists is nothing this device can honour.
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
