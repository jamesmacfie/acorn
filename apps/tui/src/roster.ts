import { agentsClientPlugin } from '@acorn/plugin-agents/client/index.ts'
import { contextClientPlugin } from '@acorn/plugin-context/client/index.ts'
import { dockerClientPlugin } from '@acorn/plugin-docker/client/index.ts'
import { editorClientPlugin } from '@acorn/plugin-editor/client/index.ts'
import { githubClientPlugin } from '@acorn/plugin-github/client/index.ts'
import { gitClientPlugin } from '@acorn/plugin-git/client/index.ts'
import { memoryClientPlugin } from '@acorn/plugin-memory/client/index.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { onboardingClientPlugin } from '@acorn/plugin-onboarding/client/index.ts'
import { previewClientPlugin } from '@acorn/plugin-preview/client/index.ts'
import { terminalClientPlugin } from '@acorn/plugin-terminal/client/index.ts'
import { workflowsClientPlugin } from '@acorn/plugin-workflows/client/index.ts'
import { initClientPlugins } from '@acorn/client-core/host/registries/extensionPoints'

// The roster: one line per plugin, through the registry rather than by importing each contribution,
// because that is where a pane comes from on the desktop too. It is the same twelve the desktop
// registers (docs/tui/plugin-losses.md § What a plugin loses here). A loaded plugin is not on this
// list: it arrives from a node as a bundle, and the client runtime's `watchPluginChanges` finds it
// once a node is reachable.
//
// ## Why this is its own module, imported after the first frame
//
// These imports pull in every pane, source and query module in twelve plugins. `main.tsx` awaits
// `App` before it creates a renderer, so holding them in `App.tsx` would evaluate all of that before
// a cell is drawn. ../scripts/check-startup-graph.mjs fails the build if the roster reaches the
// startup graph.
//
// Registering after the frame is safe because every contribution registry is a Solid signal
// (client-core kit/lib/state/registry.ts): the shell draws its chrome, this lands, and the rail, the pane
// strip and the palette fill from the same reactivity that already handles a loaded plugin arriving
// from a node seconds later. What must NOT move behind the frame is the four host seams in `App.tsx`
// — the layout table above all, which a pane needs before it can draw at all.
export function installRoster(): void {
  initClientPlugins([
    agentsClientPlugin,
    contextClientPlugin,
    dockerClientPlugin,
    editorClientPlugin,
    githubClientPlugin,
    gitClientPlugin,
    memoryClientPlugin,
    notesClientPlugin,
    onboardingClientPlugin,
    previewClientPlugin,
    terminalClientPlugin,
    workflowsClientPlugin,
  ])
}
