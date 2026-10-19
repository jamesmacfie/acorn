import { lazy } from 'solid-js'
import { dashboardCellRegistry, type ClientPlugin } from '@acorn/plugin-api/client'
import { AGENT_TOOL_CARD_POINT } from '@acorn/protocol/extensionPoints.ts'
import { APP_CELL_KIND, APPS_SOURCE_ID } from '../shared/api'
import { appsSchedule, workspaceHasProjectApps } from './appsStore'
import { appsPaneContribution } from './paneContribution'

// The card loads with the first app_show in a transcript, and lang-core and the renderer with it.
const AppToolCard = lazy(() => import('./AppToolCard'))
const ProjectAppList = lazy(async () => ({ default: (await import('./ProjectApps')).ProjectAppList }))
const ProjectAppDetail = lazy(async () => ({ default: (await import('./ProjectApps')).ProjectAppDetail }))
const AppDashboardCell = lazy(async () => ({ default: (await import('./AppCell')).AppDashboardCell }))
const AppDashboardCellMenu = lazy(async () => ({ default: (await import('./AppCell')).AppDashboardCellMenu }))

export const trellisClientPlugin: ClientPlugin = {
  name: 'trellis',
  init: (ctx) => {
    // An agent-built app, drawn inline where the agent showed it (docs/agent-built-apps.md § Cards).
    ctx.extensions.register({
      id: 'trellis.app-card',
      point: AGENT_TOOL_CARD_POINT,
      label: 'Apps',
      order: 10,
      matches: ['app_show'],
      component: AppToolCard,
    })
    ctx.panes.register(appsPaneContribution)
    // One left-rail source for every project app, never one icon per app
    // (docs/agent-built-apps/project-apps.md § The Apps source). It lists the routed project's apps,
    // and shows once the workspace has one.
    ctx.sources.register({
      id: APPS_SOURCE_ID,
      order: 75,
      glyph: 'app-window',
      label: 'Apps',
      when: workspaceHasProjectApps,
      regions: { list: ProjectAppList, detail: ProjectAppDetail, scroll: true },
      projectScoped: true,
      routes: [
        { id: 'trellis.apps', path: '/p/:projectId/apps', order: 60 },
        { id: 'trellis.app', path: '/p/:projectId/apps/:appId', order: 61 },
      ],
    })
    // A project app on a Home tab, beside ordinary panels (docs/agent-built-apps/project-apps.md § On a
    // dashboard).
    ctx.contribute(dashboardCellRegistry, {
      id: APP_CELL_KIND,
      component: AppDashboardCell,
      menuItems: AppDashboardCellMenu,
    })
    ctx.schedules.register(appsSchedule)
  },
}
