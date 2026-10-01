import { createEffect, createMemo, onCleanup } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate, useParams } from '@solidjs/router'
import { integrationsOptions, prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { availableSources } from '../../features/tabs/railSources'
import { createSourceScope } from '../../features/tabs/sourceScope'
import { hiddenSourcesToOpen } from '../../features/tabs/railVisibility'
import { setSelectedSource } from '../../features/tasks/tasks'
import { sourceIsProjectScoped } from '../registries/sources/sources'
import { registerCommands, type ContributedCommand } from '../registries/commands/commands'
import { projectPath } from '../registries/commands/corePaths'

// "Open <source>" for every plugin source the desktop rail is not drawing (features/tabs/railVisibility.ts).
//
// Host-owned, so an author who hides a source by default gets a way back to it without declaring
// anything. Built from the same availability list the rail uses, so a row disappears the moment its
// plugin unloads, loses trust, or its provider or workspace gate closes, and comes back when it opens.
//
// A plugin that already ships `source.<id>.open` (docker, agents, github) keeps its own row and gets no
// second one. That id is the convention those three share; the generated row uses another, so the two
// can never collide at registration.

export function registerHiddenSourceOpeners(workspaceId: () => string | null): void {
  const params = useParams()
  const navigate = useNavigate()
  const integrations = createQuery(() => integrationsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const scope = createSourceScope(workspaceId)

  const hidden = createMemo(
    () => hiddenSourcesToOpen(availableSources(integrations.data?.integrations, scope()), prefs.data?.[PrefKeys.railVisibility]),
    [],
    // Re-registering rewrites the command registry, which this memo reads. Comparing ids and labels
    // stops that write from coming back round as a change.
    { equals: (a, b) => a.length === b.length && a.every((source, index) => source.id === b[index].id && source.label === b[index].label) },
  )

  createEffect(() => {
    const commands = registerCommands(hidden().map((source): ContributedCommand => ({
      id: `core.rail.open.${source.id}`,
      title: `Open ${source.label}`,
      hint: 'hidden from the left rail',
      keywords: [source.label, 'rail', 'source'],
      category: 'navigation',
      palette: true,
      scope: 'none',
      // The rail click's rule (features/tabs/TabRail.tsx § selectSource): a routed project stays, and a
      // task route moves to the task's project, because a browse source scopes itself to the routed one.
      run: (context) => {
        if (sourceIsProjectScoped(source.id) && !params.projectId && !context.projectId) {
          throw new Error(`${source.label} shows one project at a time. Open a project first.`)
        }
        setSelectedSource(source.id)
        if (!params.projectId && context.projectId) navigate(projectPath(context.projectId))
      },
    })))
    onCleanup(() => commands.dispose())
  })
}
