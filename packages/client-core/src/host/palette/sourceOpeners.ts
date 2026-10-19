import { createMemo } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useLocation, useNavigate, useParams } from '@solidjs/router'
import { integrationsOptions, prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { availableSources } from '../../features/tabs/railSources'
import { createSourceScope } from '../../features/tabs/sourceScope'
import { parseRailVisibility, shownInRail } from '../../features/tabs/railVisibility'
import { registerSourceOpeners } from '../../features/tabs/sourceOpeners'
import { setSelectedSource } from '../../features/tasks/tasks'
import { sourceIsProjectScoped, sourceOpeningPath } from '../registries/sources/sources'

// The desktop's "Open <source>" rows and their unbound shortcuts, for every source the rail can draw
// (`registerSourceOpeners`). Built from the same availability list the rail uses, and marked on the
// rows the rail isn't drawing (features/tabs/railVisibility.ts).
//
// Registered from the command palette, which the overlay slot mounts for the window's life, so a
// shortcut works before the palette has ever been opened.

export function registerDesktopSourceOpeners(workspaceId: () => string | null): void {
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const integrations = createQuery(() => integrationsOptions(true))
  const prefs = createQuery(() => prefsOptions(true))
  const scope = createSourceScope(workspaceId)
  const visibility = createMemo(() => parseRailVisibility(prefs.data?.[PrefKeys.railVisibility]))

  registerSourceOpeners({
    sources: () => availableSources(integrations.data?.integrations, scope()),
    hidden: (sourceId) => !shownInRail(sourceId, visibility()),
    shortcuts: true,
    // The rail click's rule (features/tabs/TabRail.tsx § selectSource), through the same `sourceOpeningPath`.
    open: (source, context) => {
      const projectId = params.projectId ?? context.projectId ?? undefined
      if (sourceIsProjectScoped(source.id) && !projectId) {
        throw new Error(`${source.label} shows one project at a time. Open a project first.`)
      }
      setSelectedSource(source.id)
      const path = sourceOpeningPath(source.id, location.pathname, projectId)
      if (path) navigate(path)
    },
  })
}
