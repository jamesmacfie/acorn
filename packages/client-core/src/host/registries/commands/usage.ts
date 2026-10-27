// Which palette commands this person uses, so the palette can rank them higher
// (docs/command-palette-and-shortcuts/palette.md § Ranking by use).
//
// One decaying score per command id: each use adds 1 to the score, and the score halves every week
// it goes unused. Ids and numbers only. A search result's id can carry a name, so only commands are
// counted, and only picks made in the palette.
//
// Module state, like the workspace history (features/workspaces/lastWorkspace.ts): the persisted
// slice hydrates it and saves it, and a palette session reads it once per opening.

import { createSignal } from 'solid-js'

export type CommandUse = { readonly score: number; readonly at: number }
export type CommandUsage = Readonly<Record<string, CommandUse>>

const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000
export const MAX_COMMAND_USES = 200
const MIN_SCORE = 0.05

/** A stored score as it stands at `now`. A clock that went backwards never raises it. */
export const decayedScore = (use: CommandUse, now: number): number =>
  use.score * 2 ** (-Math.max(0, now - use.at) / HALF_LIFE_MS)

/** Drop what has faded below the floor, then the weakest, until the cap holds. */
export const pruneUsage = (usage: CommandUsage, now: number): CommandUsage =>
  Object.fromEntries(
    Object.entries(usage)
      .map(([id, use]) => ({ id, use, score: decayedScore(use, now) }))
      .filter((entry) => entry.score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_COMMAND_USES)
      .map((entry) => [entry.id, entry.use]),
  )

export const withUse = (usage: CommandUsage, commandId: string, now: number): CommandUsage => {
  const previous = usage[commandId]
  const score = (previous ? decayedScore(previous, now) : 0) + 1
  return pruneUsage({ ...usage, [commandId]: { score, at: now } }, now)
}

/** Every command's score at `now`, for a session to rank from until it closes. */
export const usageSnapshot = (usage: CommandUsage, now: number): ReadonlyMap<string, number> =>
  new Map(Object.entries(usage).map(([id, use]) => [id, decayedScore(use, now)]))

const [usage, setUsage] = createSignal<CommandUsage>({})

export const commandUsage = usage

/** Called by the persisted slice on restore. */
export function hydrateCommandUsage(value: CommandUsage): void {
  setUsage(value)
}

export function recordCommandUse(commandId: string, now: number = Date.now()): void {
  setUsage((current) => withUse(current, commandId, now))
}
