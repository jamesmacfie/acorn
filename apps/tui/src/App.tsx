/** @jsxImportSource @opentui/solid */
import { createComponent } from 'solid-js'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { Task } from '@acorn/protocol/api.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints/plugin.ts'
import { paneContributions } from '@acorn/client-core/host/registries/panes/panes.ts'
import { setLayouts } from '@acorn/client-core/host/layouts/table.ts'
import { nodeStatus } from '@acorn/client-core/infra/node/fleet.ts'
import { LAYOUTS } from './layouts'

// The toy: one pane, one task, no chrome. The rail, the pane row and the task switcher are phase 4.
//
// The pane is Notes, unchanged, imported from its own package the way the desktop imports it. It is a
// `list-detail` pane whose three regions share a model the host builds once, so this is the smallest
// thing that exercises the region seam as well as the kit.
//
// http and linear are what phase 0 was written against. Both turned out to ship only a tree bundle
// (`plugins/http/src/tree/`, no `client/`), so drawing either means the worker sandbox, which is
// phase 5. See docs/future/terminal/findings.md.

// No persister: `clientFor` in client-core's fleet.ts builds one over `idb-keyval`, and there is no
// IndexedDB here. A file persister is phase 3's, which is where a config directory exists to put one
// in; nothing is kept across runs until then.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })

// This host's layout table, before any pane draws. Phase 0 could not do this: the pane registry named
// client-core's DOM table directly, so `paneContributions()` handed back a component this host could
// not use, and the toy read the regions back off the entry and drew them itself. Phase 2 made the
// table a seam, so a pane's own component is now the thing that draws
// (client-core/host/layouts/table.ts, docs/future/terminal/findings.md).
setLayouts(LAYOUTS)

// Through the registry rather than by importing the contribution, because that is where a pane comes
// from on the desktop too: the plugin registers, the host reads. It also means the TUI's roster is one
// line per plugin, which is what phase 6 grows.
initClientPlugins([notesClientPlugin])
const notesPane = paneContributions().find((pane) => pane.id === 'notes')!

// What the footer says when the node is anything but online. Phase 4 draws the real one from the
// keymap's active layers; until then this line is where a connection the broker has given up on
// becomes visible, which is the half of phase 3 a person can see. `revoked` never retries, so it says
// what to do rather than what happened.
const CONNECTION: Record<string, string> = {
  degraded: 'reconnecting to the node…',
  offline: 'the node is unreachable — retrying',
  incompatible: 'this node speaks a different protocol version — upgrade whichever is older',
  revoked: 'this device was revoked on the node — pair again to come back',
}

export function App(props: { task: Task; nodeId: string }) {
  const footer = (): string => CONNECTION[nodeStatus(props.nodeId)?.state ?? 'online'] ?? 'j/k move · enter open · f6 region · q quit'
  return (
    <QueryClientProvider client={queryClient}>
      <box flexDirection="column" flexGrow={1}>
        <text attributes={1}>{`acorn · ${props.task.title} · notes`}</text>
        {/* The pane's own component, model root and all. The regions, the per-task model and the
            hidden-region check were host-neutral already; the layout table was the one thing that
            was not. */}
        {createComponent(notesPane.component, { get task() { return props.task } })}
        <text attributes={2}>{footer()}</text>
      </box>
    </QueryClientProvider>
  )
}
