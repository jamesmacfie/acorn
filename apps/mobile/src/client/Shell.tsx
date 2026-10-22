import { createEffect, Match, onCleanup, Show, Switch, type ParentProps } from 'solid-js'
import { lazy } from 'solid-js'
import { Route, Router, useNavigate } from '@solidjs/router'
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
  setActiveNode,
} from '@acorn/client-core/infra/node/activeNode.ts'
import { clientFor, refreshFleet } from '@acorn/client-core/infra/node/fleet.ts'
import { applyAppearance } from '@acorn/client-core/infra/persistence'
import { QueryCacheProvider } from '@acorn/client-core/infra/persistence/QueryCacheProvider.tsx'
import { claimNarrowBack } from '@acorn/client-core/kit/lib'
import { prefsOptions, projectsKey, tasksKey, type Project, type Task } from '@acorn/client-core/infra/queries.ts'
import { Button, EmptyState } from '@acorn/client-core/kit/components/primitives.tsx'
import { signedOut } from './platform'
import { trackKeyboardInset } from './keyboardInset'
import { Nodes } from './Nodes'
import { SignIn } from './SignIn'
import { TaskScreen } from './TaskScreen'
import { trackThemeColor } from './themeColor'
import { WaitingProvider } from './waiting'
import { Workspace } from './Workspace'
import { Workspaces } from './Workspaces'

// The desktop's pairing dialog, which a phone shows too: an ask to pair a new device is answered from
// whichever paired device is at hand.
const PairingRequestDialog = lazy(() => import('@acorn/client-core/host/trust/PairingRequestDialog.tsx'))

// The phone's screens: sign-in while the account says this phone has no session, the Nodes screen while
// it is paired with none, and then the routes. The routes draw only once a Node is selected, and the
// cached shell stays up through an outage after that, with the Node's state in the top bar.

// Make a Node the one on screen. The fleet is read first, because a Node paired a moment ago isn't in the
// client's copy of it yet.
async function openNode(nodeId: string): Promise<void> {
  await refreshFleet()
  setActiveNode(nodeId)
  await selectActiveNode()
}

export function Shell() {
  return (
    <Switch
      fallback={
        <EmptyState busy title="Connecting">
          Opening your Nodes.
        </EmptyState>
      }
    >
      <Match when={signedOut()}>
        <SignIn />
      </Match>
      <Match when={nodeReadiness().kind === 'unpaired'}>
        <div class="mobile-shell">
          <Nodes onOpen={(nodeId) => void openNode(nodeId)} />
        </div>
      </Match>
      <Match when={nodeReadiness().kind === 'failed'}>
        <EmptyState
          title="Can't open your Nodes"
          action={<Button onPress={() => void selectActiveNode()}>Try again</Button>}
        >
          This phone couldn't read the Nodes it is paired with.
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
                  <Route path="/nodes" component={NodesRoute} />
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

// The Nodes screen inside the app, to switch Nodes from. Back goes to the Node it came from.
function NodesRoute() {
  const navigate = useNavigate()
  return (
    <Nodes
      onBack={() => navigate('/')}
      onOpen={(nodeId) => {
        navigate('/')
        void openNode(nodeId)
      }}
    />
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
      <PairingRequestDialog />
      <ToastHost />
    </div>
  )
}
