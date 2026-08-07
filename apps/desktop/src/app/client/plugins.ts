// The client plugin list (docs/vNext/plugins.md § The plugin API). The mirror of
// apps/node/src/server/plugins.ts: one place, one array, and a plugin that is not here does not exist.
//
// **Declaration order here is load-bearing for NOTHING.** Every client registry sorts on a declared field:
// panes and settings pages by `order`, slots by `order` within a slot, palette rows by `order`, agent contexts
// by label — and, as of the Phase 3 review, the rail's Sources by `order` too (registries/sources.ts). Phase 3
// shipped the rail reading `sourceRegistry.entries()` in registration order, which made this file's first six
// entries load-bearing and left the rule stated only in a comment. Worse, the only check was e2e S1, and it
// could not see a reorder: `availableSources` hides a provider-gated source with no connected integration, so
// Linear and Rollbar — github's two immediate neighbours — never appeared in the assertion at all.
//
// Panes keep their ui.md order (10 pr, 15 agents, 20 changes, 30 notes, 40 context, 50 editor, 60 search,
// 70 database, 75 docker, 76 http, 80 preview, 90 linear, 100 rollbar) no matter what this file says, and the
// rail now reads GitHub, Linear, Rollbar, Docker, API, Agents for the same reason: each source says so.
//
// There is no init-time cross-plugin resolution on the client either — a plugin that needs another's UI imports
// its `contract/`, and the six remaining direct imports are Phase 3's.
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { agentsClientPlugin } from '@acorn/plugin-agents/client/index.ts'
import { changesClientPlugin } from '@acorn/plugin-changes/client/index.ts'
import { contextClientPlugin } from '@acorn/plugin-context/client/index.ts'
import { databaseClientPlugin } from '@acorn/plugin-database/client/index.ts'
import { dockerClientPlugin } from '@acorn/plugin-docker/client/index.ts'
import { editorClientPlugin } from '@acorn/plugin-editor/client/index.ts'
import { githubClientPlugin } from '@acorn/plugin-github/client/index.ts'
import { httpClientPlugin } from '@acorn/plugin-http/client/index.ts'
import { linearClientPlugin } from '@acorn/plugin-linear/client/index.ts'
import { memoryClientPlugin } from '@acorn/plugin-memory/client/index.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { onboardingClientPlugin } from '@acorn/plugin-onboarding/client/index.tsx'
import { previewClientPlugin } from '@acorn/plugin-preview/client/index.ts'
import { rollbarClientPlugin } from '@acorn/plugin-rollbar/client/index.ts'
import { terminalClientPlugin } from '@acorn/plugin-terminal/client/index.ts'
import { workflowsClientPlugin } from '@acorn/plugin-workflows/client/index.ts'

// Sixteen of the twenty plugins. The other four have no client contributions to make, which is the
// honest outcome rather than a gap — plugins.md says a plugin with no client part omits the entrypoint:
//
//   model-providers, profiles-aider, profiles-claude, profiles-codex — no client/ directory at all.
//     They are node-side adapters (provider SDK calls, agent CLI profiles) consumed through core
//     registries.
// memory and onboarding both came OFF that list in Phase 3. Memory got the client context-section registry,
// which is what removed the `context -> memory` edge. Onboarding got an overlay slot once the FIRST-RUN GATE
// moved into the plugin — App.tsx used to own the five-clause `<Show>` deciding when this plugin's modal
// appears, which is why "nothing registrable" was true rather than lazy.
export const clientPlugins: readonly ClientPlugin[] = [
  // Alphabetical, because nothing reads this order. The six rail sources used to have to lead this list in rail
  // order; they declare `order` now, so this is just a list.
  agentsClientPlugin,
  changesClientPlugin,
  contextClientPlugin,
  databaseClientPlugin,
  dockerClientPlugin,
  editorClientPlugin,
  githubClientPlugin,
  httpClientPlugin,
  linearClientPlugin,
  memoryClientPlugin,
  notesClientPlugin,
  onboardingClientPlugin,
  previewClientPlugin,
  rollbarClientPlugin,
  terminalClientPlugin,
  workflowsClientPlugin,
]
