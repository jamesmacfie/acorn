/** @jsxImportSource @opentui/solid */
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { agentsClientPlugin } from '@acorn/plugin-agents/client/index.ts'
import { changesClientPlugin } from '@acorn/plugin-changes/client/index.ts'
import { contextClientPlugin } from '@acorn/plugin-context/client/index.ts'
import { dockerClientPlugin } from '@acorn/plugin-docker/client/index.ts'
import { editorClientPlugin } from '@acorn/plugin-editor/client/index.ts'
import { githubClientPlugin } from '@acorn/plugin-github/client/index.ts'
import { memoryClientPlugin } from '@acorn/plugin-memory/client/index.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { onboardingClientPlugin } from '@acorn/plugin-onboarding/client/index.ts'
import { previewClientPlugin } from '@acorn/plugin-preview/client/index.ts'
import { terminalClientPlugin } from '@acorn/plugin-terminal/client/index.ts'
import { workflowsClientPlugin } from '@acorn/plugin-workflows/client/index.ts'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints/plugin.ts'
import { setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { setLayouts } from '@acorn/client-core/host/layouts/table.ts'
import { setRemoteTree } from '@acorn/client-core/host/tree/table.ts'
import { LAYOUTS } from './layouts'
import { RemoteTree } from './plugins/RemoteTree'
import { installPluginWorkers } from './plugins/workerFactory'
import { Shell } from './chrome/Shell'

// The composition root's client half: the roster, the layout table, and the query client under which
// the whole shell runs. What is on screen is `chrome/Shell.tsx`; this is what has to be true before
// it draws.
//
// No persister. `clientFor` in client-core's fleet.ts builds one over the storage seam and the TUI
// installs a directory of files behind it (./node/cache.ts), but that is per node and this is the
// client the shell itself runs under.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })

// This host's layout table, before any pane draws. Phase 0 could not do this: the pane registry named
// client-core's DOM table directly, so `paneContributions()` handed back a component this host could
// not use. Phase 2 made the table a seam, so a pane's own component is now the thing that draws
// (client-core/host/layouts/table.ts, docs/tui.md).
setLayouts(LAYOUTS)

// The loaded-plugin path, the same two seams one level up: a plugin's tree is drawn by this host's
// `RemoteTree` into cells, and the worker it emits from is a `node:worker_threads` thread under
// `--permission` rather than a Web Worker under a CSP (docs/tui.md).
setRemoteTree(RemoteTree)
installPluginWorkers()

// The roster: one line per plugin, through the registry rather than by importing each contribution,
// because that is where a pane comes from on the desktop too. It is the same twelve the desktop
// registers, and eight panes reach the strip (docs/tui.md § What a plugin loses here). A loaded plugin
// is not on this list and never will be: it arrives from a node as a bundle, and
// `syncPluginDistribution` in main.tsx is what finds it.
// …and no landing page. `selectedSource()` resolves an unset selection to whichever registered source
// is the default, which on the desktop is core's own home page and here is whichever plugin's browse
// source happens to be first — so the shell would open on a repo browser instead of on the reader's
// work. This host opens on a task (chrome/Shell.tsx § Open on something), so the selection starts
// explicitly empty and only the rail puts a source in it.
setSelectedSource(null)

initClientPlugins([
  agentsClientPlugin,
  changesClientPlugin,
  contextClientPlugin,
  dockerClientPlugin,
  editorClientPlugin,
  githubClientPlugin,
  memoryClientPlugin,
  notesClientPlugin,
  onboardingClientPlugin,
  previewClientPlugin,
  terminalClientPlugin,
  workflowsClientPlugin,
])

export function App(props: { nodeId: string; supervised: boolean; onQuit: () => void }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell nodeId={props.nodeId} supervised={props.supervised} onQuit={props.onQuit} />
    </QueryClientProvider>
  )
}
