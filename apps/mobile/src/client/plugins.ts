import { agentsClientPlugin } from '@acorn/plugin-agents/client/index.ts'
import { bitbucketClientPlugin } from '@acorn/plugin-bitbucket/client/index.ts'
import { contextClientPlugin } from '@acorn/plugin-context/client/index.ts'
import { dockerClientPlugin } from '@acorn/plugin-docker/client/index.ts'
import { editorClientPlugin } from '@acorn/plugin-editor/client/index.ts'
import { githubClientPlugin } from '@acorn/plugin-github/client/index.ts'
import { gitlabClientPlugin } from '@acorn/plugin-gitlab/client/index.ts'
import { gitClientPlugin } from '@acorn/plugin-git/client/index.ts'
import { memoryClientPlugin } from '@acorn/plugin-memory/client/index.ts'
import { notesClientPlugin } from '@acorn/plugin-notes/client/index.ts'
import { onboardingClientPlugin } from '@acorn/plugin-onboarding/client/index.ts'
import { previewClientPlugin } from '@acorn/plugin-preview/client/index.ts'
import { terminalClientPlugin } from '@acorn/plugin-terminal/client/index.ts'
import { trellisClientPlugin } from '@acorn/plugin-trellis/client/index.ts'
import { workflowsClientPlugin } from '@acorn/plugin-workflows/client/index.ts'
import type { ClientPlugin } from '@acorn/client-core/host/registries/extensionPoints'

// The built-in client plugins, the same fifteen the desktop registers. A pane that can't work on a
// phone says so itself rather than leaving this list. Imported after the first frame (./roster.ts).
export const clientPlugins: readonly ClientPlugin[] = [
  agentsClientPlugin,
  bitbucketClientPlugin,
  contextClientPlugin,
  dockerClientPlugin,
  editorClientPlugin,
  githubClientPlugin,
  gitlabClientPlugin,
  gitClientPlugin,
  memoryClientPlugin,
  notesClientPlugin,
  onboardingClientPlugin,
  previewClientPlugin,
  terminalClientPlugin,
  trellisClientPlugin,
  workflowsClientPlugin,
]
