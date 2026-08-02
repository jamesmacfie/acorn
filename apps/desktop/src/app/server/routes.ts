// App-layer activation: register every plugin-owned HTTP router into the core route registry.
// This is the ONE place allowed to import both core and plugin server parts — the composition root
// imports it before createApp() runs, so core/server/index.ts never names a product route module
// (docs/plugins.md). Adding a plugin route is a one-line edit here, not a core edit.
import { registerRoute } from '@acorn/node-core/server/routeRegistry.ts'
import { agentUsage } from '@acorn/plugin-agents/server/routes/usage.ts'
import { managedAgents } from '@acorn/plugin-agents/server/routes/managed.ts'
import { actions } from '@acorn/plugin-github/server/routes/actions.ts'
import { prActions } from '@acorn/plugin-github/server/routes/prActions.ts'
import { prCreate } from '@acorn/plugin-github/server/routes/prCreate.ts'
import { pullBlob } from '@acorn/plugin-github/server/routes/pullBlob.ts'
import { pullDetail } from '@acorn/plugin-github/server/routes/pullDetail.ts'
import { pullConflicts } from '@acorn/plugin-github/server/routes/pullConflicts.ts'
import { pullFiles } from '@acorn/plugin-github/server/routes/pullFiles.ts'
import { pulls } from '@acorn/plugin-github/server/routes/pulls.ts'
import { pullsBatch } from '@acorn/plugin-github/server/routes/pullsBatch.ts'
import { mentions } from '@acorn/plugin-github/server/routes/mentions.ts'
import { repos } from '@acorn/plugin-github/server/routes/repos.ts'
import { repoLabels } from '@acorn/plugin-github/server/routes/repoLabels.ts'
import { database } from '@acorn/plugin-database/server/routes/database.ts'
import { docker } from '@acorn/plugin-docker/server/routes/docker.ts'
import { editor } from '@acorn/plugin-editor/server/routes/editor.ts'
import { http } from '@acorn/plugin-http/server/routes/http.ts'
import { knowledge } from '@acorn/plugin-memory/server/routes/knowledge.ts'
import { localGit } from '@acorn/plugin-changes/server/routes/localGit.ts'
import { reviewNotes } from '@acorn/plugin-changes/server/routes/reviewNotes.ts'
import { search } from '@acorn/plugin-editor/server/routes/search.ts'
import { terminal } from '@acorn/plugin-terminal/server/routes/terminal.ts'
import { workflow } from '@acorn/plugin-workflows/server/routes/workflow.ts'

// /api/tasks/:id/* sub-resources (order-independent: distinct sub-paths under the core tasks router)
registerRoute({ prefix: '/api/tasks', router: reviewNotes, note: '/:id/review-notes (changes)' })
registerRoute({ prefix: '/api/tasks', router: search, note: '/:id/search (editor)' })
registerRoute({ prefix: '/api/tasks', router: editor, note: '/:id/editor/* (editor)' })
registerRoute({ prefix: '/api/tasks', router: localGit, note: '/:id/local/* (changes)' })
registerRoute({ prefix: '/api/tasks', router: database, note: '/:id/database/* (database)' })

// /api/docker/* — the local docker daemon surface (docker)
registerRoute({ prefix: '/api/docker', router: docker })

// /api/http/:owner/:repo/* — the API panel's saved requests, variables and send (http).
// Not /api/api/*: 'api' already means the public automation API here (docs/public-api.md).
registerRoute({ prefix: '/api/http', router: http, note: '/:owner/:repo/* (http)' })

// /api/agents/* — account-scoped local provider usage (agents)
registerRoute({ prefix: '/api/agents', router: agentUsage })
registerRoute({ prefix: '/api/agents', router: managedAgents })

// /api catch-alls
registerRoute({ prefix: '/api', router: workflow, note: 'workflow control (workflows)' })
registerRoute({ prefix: '/api', router: knowledge, note: 'notes/memory pane (memory)' })
registerRoute({ prefix: '/api', router: terminal, note: 'terminal control (terminal)' })

// /api/repos/* (github)
registerRoute({ prefix: '/api/repos', router: repos })
registerRoute({ prefix: '/api/repos', router: repoLabels, note: '/:owner/:repo/labels' })
registerRoute({ prefix: '/api/repos', router: pulls })
registerRoute({ prefix: '/api/repos', router: pullDetail })
registerRoute({ prefix: '/api/repos', router: pullConflicts, note: '/:owner/:repo/pulls/:number/conflicts' })
registerRoute({ prefix: '/api/repos', router: pullFiles })
registerRoute({ prefix: '/api/repos', router: pullBlob })
registerRoute({ prefix: '/api/repos', router: pullsBatch })
registerRoute({ prefix: '/api/repos', router: prActions })
registerRoute({ prefix: '/api/repos', router: actions })
registerRoute({ prefix: '/api/repos', router: prCreate })
registerRoute({ prefix: '/api/repos', router: mentions })

// Provider-owned HTTP routers (linear/rollbar) are registered in app/server/providers.ts via the
// integration provider registry, mounted through buildIntegrationProviderRoutes() in createApp().
