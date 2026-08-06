// The client plugin list (docs/vNext/plugins.md § The plugin API). The mirror of
// apps/node/src/server/plugins.ts: one place, one array, and a plugin that is not here does not exist.
//
// **Declaration order is load-bearing in exactly one way, and only one.** The rail's Source order is
// `sourceRegistry.entries()` in registration order, so the rail reads GitHub, Linear, Rollbar, Docker, API,
// Agents, and the first SIX entries below are in that order to keep it. github joined that block in Phase 3:
// client-core/tabs/sources.ts used to prepend it as a hardcoded literal outside the registry, so its position
// was guaranteed by code rather than by this list. e2e S1 asserts the resulting order. Everything else sorts on its own field:
// panes and settings pages by `order`, slots by `order` within a slot, agent contexts by label. Panes
// therefore keep their ui.md order (10 pr, 15 agents, 20 changes, 30 notes, 40 context, 50 editor,
// 60 search, 70 database, 75 docker, 76 http, 80 preview, 90 linear, 100 rollbar) no matter what this
// file says, which is why the two integration providers can sit at the top without moving their panes.
//
// Nothing else here may depend on order. There is no init-time cross-plugin resolution on the client at
// all — a plugin that needs another's UI imports its `contract/`, and the six remaining direct imports
// are Phase 3's.
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
  // Order-sensitive block: these six own the rail's sources, in rail order. github MUST stay first.
  githubClientPlugin,
  linearClientPlugin,
  rollbarClientPlugin,
  dockerClientPlugin,
  httpClientPlugin,
  agentsClientPlugin,
  // Order-insensitive from here.
  changesClientPlugin,
  contextClientPlugin,
  databaseClientPlugin,
  editorClientPlugin,
  memoryClientPlugin,
  notesClientPlugin,
  onboardingClientPlugin,
  previewClientPlugin,
  terminalClientPlugin,
  workflowsClientPlugin,
]
