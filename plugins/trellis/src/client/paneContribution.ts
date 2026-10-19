import { createSignal, lazy, onCleanup, type Accessor } from 'solid-js'
import { clientEvents, consumePaneIntent, type PaneLayoutContribution, type Task } from '@acorn/plugin-api/client'
import { APPS_PANE_ID, type AppListing } from '../shared/api'
import { taskApps } from './appsStore'

// The task's Apps pane (docs/agent-built-apps.md § The Apps pane): its shown apps in the list, and the
// selected one at full size in the detail, with the conversation that edits it. Gated, so a task that
// never showed an app has no button. Its regions load with lang-core when the pane first opens.

const AppList = lazy(async () => ({ default: (await import('./AppsPane')).AppList }))
const AppDetail = lazy(async () => ({ default: (await import('./AppsPane')).AppDetail }))

export type AppsPaneModel = {
  /** The app the person picked or a card opened, while the task still lists it; else the newest. */
  selected: Accessor<AppListing | undefined>
  select(appId: string): void
  /** Whether the editing conversation is open under the app. */
  editing: Accessor<boolean>
  setEditing(open: boolean): void
}

function createAppsPaneModel(task: Task): AppsPaneModel {
  // A card's Open names the app, and the pane may not be mounted yet when it does.
  const picked = consumePaneIntent(task.id, APPS_PANE_ID, 'plugin:select')
  const [chosen, setChosen] = createSignal(picked?.kind === 'plugin:select' ? picked.item : undefined)
  onCleanup(
    clientEvents.on('presentation:pane-intent', (event) => {
      if (event.taskId !== task.id || event.paneId !== APPS_PANE_ID || event.intent.kind !== 'plugin:select') return
      consumePaneIntent(task.id, APPS_PANE_ID)
      setChosen(event.intent.item)
    }),
  )
  const [editing, setEditing] = createSignal(false)
  return {
    selected: () => {
      const apps = taskApps(task.id)
      return apps.find((app) => app.appId === chosen()) ?? apps[0]
    },
    select: setChosen,
    editing,
    setEditing,
  }
}

export const appsPaneContribution: PaneLayoutContribution<AppsPaneModel> = {
  id: APPS_PANE_ID,
  label: 'Apps',
  glyph: 'app-window',
  description: 'Apps an agent built in this task',
  order: 27,
  requires: { plugin: 'trellis' },
  when: (task) => taskApps(task.id).length > 0,
  // The editing conversation draws the Agent pane's composer, which needs the width that pane asks for.
  minWidth: 640,
  layout: 'list-detail',
  model: (task) => createAppsPaneModel(task),
  regions: { list: AppList, detail: AppDetail },
  // Apps are files under the data root, not in the worktree, so an archived task keeps them. The
  // archived preview lists them and their programs, and draws none.
  readsArchived: true,
}
