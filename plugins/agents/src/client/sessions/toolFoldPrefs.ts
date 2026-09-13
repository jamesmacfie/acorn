// How a tool call's disclosure starts out in a transcript, and where that answer is stored. One JSON
// pref (agent_tool_fold) read from the prefs query and written through saveJsonPref, the same shape
// the docker plugin uses for its own (docs/managed-agents.md § Tool call display).
import { createContext, useContext } from 'solid-js'
import type { QueryClient } from '@tanstack/solid-query'
import { z } from 'zod'
import { type PersistedStateSlice, PrefKeys, saveJsonPref } from '@acorn/plugin-api/client'

export type AgentToolFoldMode = 'expanded' | 'collapsed' | 'sticky'

export type AgentToolFoldPrefs = {
  mode: AgentToolFoldMode
  /** The reader's last toggle. Read only in `sticky` mode, written only by a toggle made while it is on. */
  last: 'expanded' | 'collapsed'
}

// Collapsed, because a turn that ran twenty calls is unreadable with all of them open, and the state a
// card is in is one click away. This is a change for a provider whose calls used to open themselves
// while they ran: `collapsed` means a command's output no longer streams into view unattended.
export const defaultAgentToolFoldPrefs: AgentToolFoldPrefs = { mode: 'collapsed', last: 'collapsed' }

const agentToolFoldSchema = z.strictObject({
  mode: z.enum(['expanded', 'collapsed', 'sticky']).optional(),
  last: z.enum(['expanded', 'collapsed']).optional(),
})

export function readAgentToolFoldPrefs(prefs: Record<string, string> | undefined): AgentToolFoldPrefs {
  try {
    const raw = prefs?.[PrefKeys.agentToolFold]
    if (!raw) return defaultAgentToolFoldPrefs
    const parsed = agentToolFoldSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { ...defaultAgentToolFoldPrefs, ...parsed.data } : defaultAgentToolFoldPrefs
  } catch {
    return defaultAgentToolFoldPrefs
  }
}

/** Whether a card mounting now starts open. */
export const foldStartsOpen = (prefs: AgentToolFoldPrefs): boolean =>
  prefs.mode === 'sticky' ? prefs.last === 'expanded' : prefs.mode === 'expanded'

/**
 * What a reader's toggle should be stored as, or `null` when it should not be stored at all. Only
 * `sticky` learns: under the other two modes a toggle is this card's own business, and writing it
 * would quietly rewrite the setting the reader chose.
 */
export const foldPrefsAfterToggle = (
  prefs: AgentToolFoldPrefs,
  open: boolean,
): AgentToolFoldPrefs | null => {
  if (prefs.mode !== 'sticky') return null
  const last = open ? 'expanded' : 'collapsed'
  return last === prefs.last ? null : { ...prefs, last }
}

export const saveAgentToolFoldPrefs = (qc: QueryClient, next: AgentToolFoldPrefs): Promise<boolean> =>
  saveJsonPref(qc, PrefKeys.agentToolFold, next)

/** Choose the mode without disturbing the `last` toggle beside it. The page and the palette's setting
 *  command both write through this, so one value keeps one persistence path. */
export const saveAgentToolFoldMode = (
  qc: QueryClient,
  prefs: Record<string, string> | undefined,
  mode: AgentToolFoldMode,
): Promise<boolean> => saveAgentToolFoldPrefs(qc, { ...readAgentToolFoldPrefs(prefs), mode })

/** The three choices, spelled once for the page's picker and the command's options. */
export const AGENT_TOOL_FOLD_CHOICES: readonly { value: AgentToolFoldMode; label: string }[] = [
  { value: 'collapsed', label: 'Start collapsed' },
  { value: 'expanded', label: 'Start expanded' },
  { value: 'sticky', label: 'Carry my last one forward' },
]

/** How the tool cards in the surrounding transcript fold. */
export type AgentToolFoldSetting = {
  /** Whether a card mounting now starts open. Call at mount and do not track it. */
  startsOpen: () => boolean
  /** Report a reader's toggle. Stores it only under `sticky`. */
  onToggle: (open: boolean) => void
  /** A counter the reader bumps with "collapse all" above the composer. A card watches it and shuts
   *  when it changes. Absent for a card drawn outside a transcript, which has nothing to collapse. */
  collapseSignal?: () => number
}

/**
 * One of these per transcript, read through context by every card below it.
 *
 * A context rather than a prop, because `AgentEventCard` recurses for a subagent's stream and a card
 * that missed the prop would silently fall back to the built-in default. A context rather than a prefs
 * query inside each card, because `prefsOptions.select` runs `mergePrefs`, which scans localStorage, on
 * every observer for every prefs write: with an observer per card, one pane resize became a few hundred
 * scans of it. A transcript holds a few hundred cards and is deliberately not virtualized
 * (AgentTranscript.tsx).
 */
export const createAgentToolFoldSetting = (
  prefs: () => Record<string, string> | undefined,
  queryClient: QueryClient,
  collapseSignal?: () => number,
): AgentToolFoldSetting => ({
  startsOpen: () => foldStartsOpen(readAgentToolFoldPrefs(prefs())),
  onToggle: (open) => {
    const next = foldPrefsAfterToggle(readAgentToolFoldPrefs(prefs()), open)
    if (next) void saveAgentToolFoldPrefs(queryClient, next)
  },
  collapseSignal,
})

// Collapsed, and remembering nothing, for a card drawn outside a transcript.
const inertFoldSetting: AgentToolFoldSetting = { startsOpen: () => false, onToggle: () => {} }

export const AgentToolFoldContext = createContext<AgentToolFoldSetting>(inertFoldSetting)
export const useAgentToolFold = (): AgentToolFoldSetting => useContext(AgentToolFoldContext)

export const agentToolFoldSlice: PersistedStateSlice<Record<string, unknown>> = {
  id: 'agents.tool-fold',
  key: PrefKeys.agentToolFold,
  scope: 'app',
  // With the transcript rather than after it: a card reads this at mount, and a restore that landed
  // later would leave the first screenful of an already-open session on the built-in default.
  restore: 'view',
  version: 1,
  codec: {
    parse: (raw) => {
      try {
        const value = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
        return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
      } catch {
        return {}
      }
    },
    serialize: (value) => value,
  },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 1024,
}
