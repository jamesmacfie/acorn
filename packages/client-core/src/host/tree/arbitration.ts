// Who fills a box when more than one contributor could (docs/plugins.md § Arbitration).
//
// No JSX here (docs/frontend.md § Registries and plugins), because the decision is the part worth a
// test: which contributors match a key, who wins a `replace` tie, where the user's pick comes in, and
// what happens past `max`. `Slot.tsx` is a `<For>` over the answer.
//
// The rule in one sentence: an override is an offer, not a seizure. Two contributors matching one key
// draw the owner's default until the user says which, because a package that could take a box by
// registering for it could take one from another package by registering later.
import type { ArbitrationMode } from '@acorn/protocol/extensionPoints.ts'
import { extensionDeliveries, type ExtensionContribution, type ExtensionPointContribution } from '../registries/extensionPoints/extensionPoints'

/**
 * Does this contributor's `matches` cover the key the owner passed?
 *
 * Three shapes, in the order an author reaches for them: no list at all is "every key", an exact
 * string, and a trailing-star prefix (`image/*`, `*.md` — the leading star form the file-pattern
 * examples use is a suffix match). Keyed rather than a predicate, because a predicate is code, and the
 * host has to decide this without running any of the contributor's.
 */
export function matchesKey(patterns: readonly string[] | undefined, key: string | undefined): boolean {
  if (!patterns?.length) return true
  if (key === undefined) return false
  return patterns.some((pattern) => {
    if (pattern === '*' || pattern === key) return true
    if (pattern.endsWith('*')) return key.startsWith(pattern.slice(0, -1))
    if (pattern.startsWith('*')) return key.endsWith(pattern.slice(1))
    return false
  })
}

export type SlotOutcome = {
  /** Who draws, in order. Empty means the owner's own default children draw. */
  occupants: ExtensionContribution[]
  /** How many matched past `max` and are not drawn, for the disclosure the host offers. */
  overflow: number
  /** Why this is the answer, for the developer view. Never rendered to a user. */
  why: 'default' | 'match' | 'user-pick' | 'tie'
}

/**
 * Who fills this slot right now.
 *
 * `choice` is the user's pick for this point out of Settings → Plugins, and it only ever settles a
 * `replace` tie: a single match wins on its own, and a pick naming a plugin that no longer matches
 * falls back to the owner's default rather than to the other candidate. Silently promoting the runner
 * up would mean the box changed hands because somebody uninstalled something.
 */
export function resolveSlot(
  point: ExtensionPointContribution,
  key: string | undefined,
  choice: string | undefined,
): SlotOutcome {
  const matching = extensionDeliveries(point.id).filter((entry) => matchesKey(entry.matches, key))
  if (matching.length === 0) return { occupants: [], overflow: 0, why: 'default' }
  if ((point.mode ?? 'stack') === 'stack') {
    return {
      occupants: matching.slice(0, point.max),
      overflow: Math.max(0, matching.length - point.max),
      why: 'match',
    }
  }
  if (matching.length === 1) return { occupants: matching, overflow: 0, why: 'match' }
  const picked = choice ? matching.find((entry) => entry.pluginId === choice) : undefined
  // A tie nobody has settled draws the owner's default. The count still comes back as overflow, so the
  // settings picker can say how many are waiting on a decision.
  return picked
    ? { occupants: [picked], overflow: matching.length - 1, why: 'user-pick' }
    : { occupants: [], overflow: matching.length, why: 'tie' }
}

/**
 * The stored arbitration, read out of the one preference that holds all of it.
 *
 * `{ '<owner>:<point>|<key>': pluginId }`, one key per point-and-selector-value, because "who draws a
 * PNG attachment" and "who draws a CSV one" are two decisions. A point with no key stores under the
 * point alone. Same one-preference-holds-all shape the exclusive slots use
 * (registries/exclusiveSlots.ts), and the same failure rule: anything unparseable reads as nothing
 * chosen, which is the owner's default.
 */
export const slotChoiceKey = (pointId: string, key: string | undefined): string =>
  key === undefined ? pointId : `${pointId}|${key}`

/**
 * The pick that applies to this slot: the one made about this exact key, else the one made about the
 * point as a whole.
 *
 * Two levels because a person deciding "the images plugin draws attachments" means every attachment
 * unless they say otherwise, and a person deciding it for `image/png` alone means that one. The
 * settings picker writes the point-wide answer, which is the one anybody actually wants to give; the
 * per-key form exists so a surface that offers the choice in place can write a narrower one.
 */
export const slotChoiceFor = (
  choices: Record<string, string>,
  pointId: string,
  key: string | undefined,
): string | undefined => choices[slotChoiceKey(pointId, key)] ?? choices[pointId]

export function slotChoices(raw: string | undefined): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([slot, value]) => (typeof value === 'string' && value ? [[slot, value]] : [])),
    )
  } catch {
    return {}
  }
}

/** The inverse, for the settings picker's write. An empty choice removes the entry rather than storing
 *  a sentinel, so the preference holds only the decisions the owner actually made. */
export function withSlotChoice(raw: string | undefined, slot: string, choice: string): string {
  const next = slotChoices(raw)
  if (choice) next[slot] = choice
  else delete next[slot]
  return JSON.stringify(next)
}

/**
 * Is anybody at all offering to fill this slot right now?
 *
 * The question an owner asks before it draws the box, rather than after: context hides a section with
 * no items of its own, and has to keep it when a plugin has something to put there. Deliberately not
 * `resolveSlot(...).occupants.length`, which would answer "and who wins", a decision that depends on a
 * user preference the owner has no business reading to make a visibility choice.
 */
export const slotFills = (pointId: string, key?: string): boolean =>
  extensionDeliveries(pointId).some((entry) => matchesKey(entry.matches, key))

export type ArbitrationModeValue = ArbitrationMode
