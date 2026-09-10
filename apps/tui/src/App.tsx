/** @jsxImportSource @acorn/tui/jsx */
import { createEffect, type JSX } from 'solid-js'
import { QueryClientProvider, createQuery, type QueryClient } from '@tanstack/solid-query'
import { prefsOptions, tasksOptions } from '@acorn/client-core/infra/queries.ts'
import { setTelemetryEnabled } from '@acorn/client-core/infra/telemetry/emitter.ts'
import { telemetryOn } from '@acorn/client-core/features/settings/telemetrySetting.ts'
import { emitBootSpans } from './boot'
import { activateTaskSignals } from '@acorn/client-core/features/tasks/activate.ts'
import { setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { setLayouts } from '@acorn/client-core/host/layouts/table.ts'
import { setSourcePanel } from '@acorn/client-core/host/chrome/sourcePanel.ts'
import { sourcePanel } from './plugins/SourcePanel'
import { setExtendedPane } from '@acorn/client-core/host/chrome/extendedPane.ts'
import { ExtendedPane } from './plugins/ExtendedPane'
import { setRemoteTree } from '@acorn/client-core/host/tree/table.ts'
import { LAYOUTS } from './layouts'
import { RemoteTree } from './plugins/RemoteTree'
import { installPluginWorkers } from './plugins/workerFactory'
import { Shell } from './chrome/Shell'

// The composition root's client half: the four host seams and the shell under the one query client
// this node has. What is on screen is `chrome/Shell.tsx`; this is what has to be true before it draws.
//
// The roster is not here. It is `./roster.ts`, imported after the first frame, and that file says why.
//
// The query client is a prop rather than a `new QueryClient()` here, and that is the caching contract
// rather than a preference. client-core builds one client and one persister per node
// (infra/node/fleet.ts § clientFor), and that is the client `watchTaskChanges` and its siblings
// invalidate. A second one minted here read a cache nobody wrote and nobody invalidated, so every
// `acorn` start was cold and a task created elsewhere never appeared
// (docs/caching.md § Renderer query cache).

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

// …and the third seam of the same shape. A plugin that contributes a rail source by descriptor rather
// than by code gets `ChromeSourcePanel` on the desktop, which is `<main class="panes">` and DOM kit
// primitives all the way down — so registering it here handed the reconciler a `main` and selecting
// Linear threw instead of drawing a list. This host supplies its own, as a list and a detail rather
// than one surface, because the two go in different panels here
// (client-core/host/chrome/sourcePanel.ts, ./plugins/SourcePanel.tsx).
setSourcePanel(sourcePanel)

// …and the fourth, which was a crash rather than a gap. A loaded plugin's pane that reserved a
// `pane.footer` or a `pane.aside` was wrapped in the DOM's `ExtendedPane` — a `div` and an `aside`
// around a `PanelGrid` — so the reconciler refused the pane rather than drawing it. This host's
// wrapper puts the reserved regions under the owner's tree in reading order
// (client-core/host/chrome/extendedPane.ts, ./plugins/ExtendedPane.tsx).
setExtendedPane(ExtendedPane)

// No core Home source. `selectedSource()` otherwise resolves an unset selection against the raw
// registry before provider/workspace gates have loaded. Keep it explicitly empty so the rail can
// choose the first source it actually draws once those gates are ready (chrome/Rail.tsx).
setSelectedSource(null)

/** `acorn --task <id>`, resolved off the shell's own tasks query rather than off a request of its own.
 *
 *  `main.tsx` used to `await readJson(tasksRoute)` before it created a renderer — a round trip on the
 *  critical path whose answer the query below asks for a moment later anyway. It waits on the first
 *  answer now, which a warm cache makes immediate.
 *
 *  A plain flag rather than `on()`: `on()` re-fires on identity change, and a fresh array from a
 *  refetch is a new identity, so this would re-activate the task under whatever the reader had since
 *  opened. The flag is the dedupe. */
function TaskArg(props: { id?: string; onMissing?: (id: string) => void; children: JSX.Element }) {
  // Read once, at setup. It comes from `parseArgs` and cannot change, and a wrapper that draws
  // nothing keeps the tree the same shape whether or not `--task` was given — so every render in the
  // suite exercises the same arrangement production does.
  const id = props.id
  if (id) {
    const query = createQuery(() => tasksOptions(true))
    let resolved = false
    createEffect(() => {
      const tasks = query.data
      if (!tasks || resolved) return
      resolved = true
      const task = tasks.find((candidate) => candidate.id === id)
      // Refused rather than drawn as an empty rail, because a name that matches nothing is a typo and
      // a person wants to hear about it. A tasks query that never answers at all is a different
      // failure and says so on the footer instead.
      if (task) activateTaskSignals(task)
      else props.onMissing?.(id)
    })
  }
  return props.children
}

/** The one telemetry switch, read off the node and handed to the emitter, which is the desktop's
 *  arrangement in `apps/desktop/src/client/App.tsx` (docs/telemetry.md § The switch).
 *
 *  Under the provider rather than beside it, because it reads a query. It draws nothing: the effect
 *  is the whole of it, and a component is how this host gets a reactive scope with the client in it.
 *
 *  The boot spans go out here too. They describe a stretch of time that was over before the switch
 *  was known, so the marks are held and turned into spans the first time the answer is yes
 *  (./boot.ts § emitBootSpans). */
function Telemetry() {
  const prefs = createQuery(() => prefsOptions(true))
  createEffect(() => {
    const on = telemetryOn(prefs.data)
    setTelemetryEnabled(on)
    if (on) emitBootSpans()
  })
  return null
}

export function App(props: {
  client: QueryClient
  nodeId: string
  supervised: boolean
  task?: string
  onNoTask?: (id: string) => void
  onQuit: () => void
}) {
  return (
    <QueryClientProvider client={props.client}>
      <Telemetry />
      <TaskArg id={props.task} onMissing={props.onNoTask}>
        <Shell nodeId={props.nodeId} supervised={props.supervised} onQuit={props.onQuit} />
      </TaskArg>
    </QueryClientProvider>
  )
}
