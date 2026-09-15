import { agentCostClientPlugin } from '@acorn/plugin-agent-cost/client/index.ts'
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

// The roster: one line per plugin, through the registry rather than by importing each contribution,
// because that is where a pane comes from on the desktop too. It is the same thirteen the desktop
// registers, and eight panes reach the strip (docs/tui.md § What a plugin loses here). A loaded plugin
// is not on this list and never will be: it arrives from a node as a bundle, and
// `watchPluginChanges` in main.tsx is what finds it, once a node is reachable.
//
// ## Why this is its own module, imported after the first frame
//
// These thirteen imports were the terminal client's eager module graph. `App.tsx` held them so their
// `init` could register at module scope, and `main.tsx` awaits `App` before it creates a renderer — so
// every pane, every source and every query module in twelve plugins was evaluated before a cell was
// drawn. That was 224 KB of the 1.03 MB the shell loaded to draw a rail
// (docs/performance.md § 2026-09-03 — phase 4).
//
// Registering after the frame is safe because every contribution registry is a Solid signal
// (client-core kit/lib/registry.ts): the shell draws its chrome, this lands, and the rail, the pane
// strip and the palette fill from the same reactivity that already handles a loaded plugin arriving
// from a node seconds later. What must NOT move behind the frame is the four host seams in `App.tsx`
// — the layout table above all, which a pane needs before it can draw at all.
export function installRoster(): void {
  initClientPlugins([
    agentsClientPlugin,
    agentCostClientPlugin,
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
}
