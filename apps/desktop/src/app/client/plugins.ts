import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { agentsClientPlugin } from '@acorn/plugin-agents/client/index.ts'
import { changesClientPlugin } from '@acorn/plugin-changes/client/index.ts'
import { contextClientPlugin } from '@acorn/plugin-context/client/index.ts'
import { databaseClientPlugin } from '@acorn/plugin-database/client/index.ts'
import { dockerClientPlugin } from '@acorn/plugin-docker/client/index.ts'
import { editorClientPlugin } from '@acorn/plugin-editor/client/index.ts'
import { githubClientPlugin } from '@acorn/plugin-github/client/index.ts'
import { httpClientPlugin } from '@acorn/plugin-http/client/index.ts'
import { memoryClientPlugin } from '@acorn/plugin-memory/client/index.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { onboardingClientPlugin } from '@acorn/plugin-onboarding/client/index.ts'
import { previewClientPlugin } from '@acorn/plugin-preview/client/index.ts'
import { terminalClientPlugin } from '@acorn/plugin-terminal/client/index.ts'
import { workflowsClientPlugin } from '@acorn/plugin-workflows/client/index.ts'

export const clientPlugins: readonly ClientPlugin[] = [
  agentsClientPlugin,
  changesClientPlugin,
  contextClientPlugin,
  databaseClientPlugin,
  dockerClientPlugin,
  editorClientPlugin,
  githubClientPlugin,
  httpClientPlugin,
  memoryClientPlugin,
  notesClientPlugin,
  onboardingClientPlugin,
  previewClientPlugin,
  terminalClientPlugin,
  workflowsClientPlugin,
]
