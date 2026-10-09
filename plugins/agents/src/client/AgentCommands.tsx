import { createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions, registerCommands, type ContributedCommand, type UiSlotContribution } from '@acorn/plugin-api/client'
import { startSessionFromPalette } from './commands'
import { agentProvidersOptions } from './providersClient'
import { customAgentsOptions } from './settings/customAgentsClient'
import { choiceLabel, newSessionChoices, type NewSessionChoice } from './sessions/newSessionChoices'
import { agentSessionDefaultsOptions, writeAgentSessionDefaults } from './settings/sessionDefaultsClient'
import {
  AGENT_TOOL_FOLD_CHOICES,
  readAgentToolFoldPrefs,
  saveAgentToolFoldMode,
  type AgentToolFoldMode,
} from './sessions/toolFoldPrefs'

// The two agent defaults the catalogue admits as palette settings: whether a session carries the last
// one's model forward, and how a tool card starts out
// (docs/managed-agents/palette.md § From the command palette).
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
// a terminal (docs/tui/plugin-losses.md § What a plugin loses here), and the tool-fold value is a device preference
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
        title: 'Start new sessions with my last model',
        hint: 'uses the model and effort you last picked',
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
        title: 'Tool call display',
        hint: 'open or closed in transcripts',
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

  const providers = createQuery(() => agentProvidersOptions())
  const customAgents = createQuery(() => customAgentsOptions())
  registerNewSessionCommands(() =>
    newSessionChoices((providers.data ?? []).filter((provider) => provider.installed), customAgents.data ?? []))

  return null
}

/** A row's id. It never changes for a harness or an agent, so a keyboard shortcut can name it. */
const commandId = (choice: NewSessionChoice): string =>
  choice.agent ? `agents.custom-agent.${choice.agent.id}` : `agents.harness.${choice.provider.id}`

/**
 * One "New <harness or agent> session" row per choice the pane's New picker offers, so typing
 * "claude" or an agent's name finds it without opening New agent session first. Registered again only
 * when the set of ids changes; a rename reaches the row through the live read in `title`. Desktop only,
 * for the reason the two settings above are: this needs the query cache, and the terminal still
 * reaches every choice through New agent session.
 */
function registerNewSessionCommands(list: () => readonly NewSessionChoice[]): void {
  const choices = createMemo(list)
  const live = (id: string) => choices().find((choice) => commandId(choice) === id)
  const roster = createMemo(() => choices().map(commandId), [] as string[], {
    equals: (before, after) => before.join() === after.join(),
  })
  createEffect(() => {
    const ids = roster()
    if (!ids.length) return
    const registered = registerCommands(ids.map((id): ContributedCommand => ({
      id,
      title: () => {
        const choice = live(id)
        return `New ${choice ? choiceLabel(choice) : 'agent'} session`
      },
      hint: () => (live(id)?.agent ? 'a custom agent, started in this task' : 'an agent session in this task'),
      keywords: ['agent', 'new', 'session', id.startsWith('agents.custom-agent.') ? 'custom' : 'harness'],
      category: 'action',
      palette: true,
      scope: 'task',
      requires: { plugin: 'agents' },
      when: () => !!live(id),
      run: (context) => {
        const choice = live(id)
        if (!choice || !context.taskId) return
        return startSessionFromPalette(
          context.taskId,
          { id: choice.provider.id, profileId: choice.agent?.profileId ?? choice.provider.profileId },
          choice.agent?.id,
        )
      },
    })))
    onCleanup(() => registered.dispose())
  })
}

export const agentCommandsSlotContribution: UiSlotContribution = {
  id: 'agents.commands',
  slot: 'overlay',
  order: 50,
  requires: { plugin: 'agents' },
  component: () => <AgentCommands />,
}
