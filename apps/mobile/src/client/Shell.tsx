import { createEffect, Match, onCleanup, Show, Switch, type ParentProps } from 'solid-js'
import { Route, Router } from '@solidjs/router'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { setProjectsLookup } from '@acorn/client-core/features/projects/projectLookup.ts'
import { setTaskLookup } from '@acorn/client-core/features/tasks'
import { ToastHost } from '@acorn/client-core/features/notifications/ToastHost.tsx'
import { PaneModelHost } from '@acorn/client-core/host/registries/panes/PaneModelHost.tsx'
import {
  activeCacheId,
  activeNodeId,
  nodeReadiness,
  nodeReady,
  selectActiveNode,
} from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor } from '@acorn/client-core/infra/node/fleet.ts'
import { applyAppearance } from '@acorn/client-core/infra/persistence'
import { QueryCacheProvider } from '@acorn/client-core/infra/persistence/QueryCacheProvider.tsx'
import { claimNarrowBack } from '@acorn/client-core/kit/lib'
import { prefsOptions, projectsKey, tasksKey, type Project, type Task } from '@acorn/client-core/infra/queries.ts'
import { Button, EmptyState } from '@acorn/client-core/kit/components/primitives.tsx'
import { signedOut } from './platform'
import { trackKeyboardInset } from './keyboardInset'
import { SignIn } from './SignIn'
import { TaskScreen } from './TaskScreen'
import { trackThemeColor } from './themeColor'
import { WaitingProvider } from './waiting'
import { Workspace } from './Workspace'
import { Workspaces } from './Workspaces'

// The phone's screens: sign-in while the gateway says this phone has no session, a wait while it
// names its Node, and then the routes. The routes draw only once a Node is selected, and the cached
// shell stays up through an outage after that, with the Node's state in the top bar.

export function Shell() {
  return (
    <Switch
      fallback={
        <EmptyState busy title="Connecting">
          Asking the gateway for its Node.
        </EmptyState>
      }
    >
      <Match when={signedOut()}>
        <SignIn />
      </Match>
      <Match when={nodeReadiness().kind === 'failed'}>
        <EmptyState
          title="Can't reach the gateway"
          action={<Button onPress={() => void selectActiveNode()}>Try again</Button>}
        >
          The phone keeps trying, and opens Acorn when the gateway answers.
        </EmptyState>
      </Match>
      <Match when={nodeReady()}>
        {/* Keyed, as on the desktop: a query started against one Node must not land in another's cache. */}
        <Show when={activeCacheId()} keyed>
          {(cacheId) => (
            <QueryCacheProvider cache={clientFor(cacheId)}>
              <PaneModelHost nodeId={activeNodeId()}>
                <Router root={Frame}>
                  <Route path="/" component={Workspaces} />
                  <Route path="/w/:workspaceId" component={() => <Workspace view="dashboard" />} />
                  <Route path="/w/:workspaceId/tasks" component={() => <Workspace view="tasks" />} />
                  <Route path="/t/:taskId/:paneId?" component={TaskScreen} />
                </Router>
              </PaneModelHost>
            </QueryCacheProvider>
          )}
        </Show>
      </Match>
    </Switch>
  )
}

// What every screen needs from the query client: the lookups client-core asks the host for, and the
// person's theme and style from their preferences.
function Frame(props: ParentProps) {
  trackKeyboardInset()
  trackThemeColor()
  // The top bar's Back steps out of a pane's detail, so a pane draws no Back row of its own.
  onCleanup(claimNarrowBack())
  const client = useQueryClient()
  setTaskLookup((taskId) => client.getQueryData<Task[]>(tasksKey)?.find((task) => task.id === taskId))
  setProjectsLookup(() => client.getQueryData<Project[]>(projectsKey) ?? [])
  const prefs = createQuery(() => prefsOptions(true))
  createEffect(() => {
    if (prefs.data) onCleanup(applyAppearance(prefs.data))
  })
  return (
    <div class="mobile-shell">
      <WaitingProvider>{props.children}</WaitingProvider>
      <ToastHost />
    </div>
  )
}
