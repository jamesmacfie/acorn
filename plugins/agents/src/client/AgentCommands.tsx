import { onCleanup, onMount } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, registerCommands, type UiSlotContribution } from '@acorn/plugin-api/client'
import { agentSessionDefaultsOptions, writeAgentSessionDefaults } from './settings/sessionDefaultsClient'
import {
  AGENT_TOOL_FOLD_CHOICES,
  readAgentToolFoldPrefs,
  saveAgentToolFoldMode,
  type AgentToolFoldMode,
} from './sessions/toolFoldPrefs'

// The two agent defaults the catalogue admits as palette settings: whether a session carries the last
// one's model forward, and how a tool card starts out
// (docs/managed-agents.md § From the command palette).
//
// **Why a mounted component rather than `ctx.commands` at boot.** Both write through the accessors
// their Settings pages already use, and both of those accessors take a `QueryClient` — the cache is
// what makes every reader move at once, and a second write path is exactly what phase 3 existed to
// prevent. There is no query client at plugin `init`: the desktop mints one per node and hands it to a
// provider. So these register where a client is in scope, which is a component, and the slot is how a
// component that draws nothing gets mounted. It is the same shape github's router-scoped commands take
// (plugins/github/src/client/Shortcuts.tsx).
//
// **Desktop only, and that is the honest answer rather than a gap.** The `overlay` slot is not drawn in
// a terminal (docs/tui.md § What a plugin loses here), and the tool-fold value is a device preference
// with nowhere to be stored there — which is the same reason core registers Appearance on the desktop
// and not in the terminal. A choice that would quietly fail to persist is worse than an absent row.
//
// Everything else on those two pages stays a page: pricing and concurrency are numeric forms, and the
// per-provider default values are a table keyed by options a provider advertises at run time.

const on = (value: boolean): string => (value ? 'on' : 'off')

export function AgentCommands() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))

  onMount(() => {
    const commands = registerCommands([
      {
        id: 'agents.settings.follow-last-session',
        kind: 'setting',
        title: 'Carry the last session’s model forward',
        hint: 'a model or effort switch becomes what the next session starts with',
        category: 'action',
        palette: true,
        scope: 'none',
        requires: { plugin: 'agents' },
        // Through the query, so the value shown is the one every other reader has, and a stale cache
        // is refreshed rather than assumed.
        read: async () => on((await queryClient.fetchQuery(agentSessionDefaultsOptions())).followLastSession),
        options: [
          { value: 'on', label: 'On', keywords: ['follow', 'yes'] },
          { value: 'off', label: 'Off', keywords: ['pinned', 'no'] },
        ],
        write: async (value) => {
          const current = await queryClient.fetchQuery(agentSessionDefaultsOptions())
          // The page's own writer, which owns the optimistic cache write and the refetch on failure.
          const saved = await writeAgentSessionDefaults(queryClient, current, { followLastSession: value === 'on' })
          return on(saved.followLastSession)
        },
      },
      {
        id: 'agents.settings.tool-cards',
        kind: 'setting',
        title: 'How a tool call starts out',
        hint: 'the disclosure on every tool card in a transcript',
        category: 'action',
        palette: true,
        scope: 'none',
        requires: { plugin: 'agents' },
        read: () => Promise.resolve(readAgentToolFoldPrefs(prefs.data).mode),
        // The page's three choices, spelled once (./sessions/toolFoldPrefs.ts).
        options: AGENT_TOOL_FOLD_CHOICES,
        write: async (value) => {
          await saveAgentToolFoldMode(queryClient, prefs.data, value as AgentToolFoldMode)
          // What was stored, read back through the same accessor the page reads.
          return readAgentToolFoldPrefs(prefs.data).mode
        },
      },
    ])
    onCleanup(() => commands.dispose())
  })

  return null
}

export const agentCommandsSlotContribution: UiSlotContribution = {
  id: 'agents.commands',
  slot: 'overlay',
  order: 50,
  requires: { plugin: 'agents' },
  component: () => <AgentCommands />,
}
