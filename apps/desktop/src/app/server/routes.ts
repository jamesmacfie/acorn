// App-layer activation: register every plugin-owned HTTP router into the core route registry.
// This is the ONE place allowed to import both core and plugin server parts — the composition root
// imports it before createApp() runs, so core/server/index.ts never names a product route module
// (docs/plugins.md). Adding a plugin route is a one-line edit here, not a core edit.
import { registerRoute } from '../../core/server/routeRegistry'
import { agentUsage } from '../../plugins/agents/server/routes/usage'
import { actions } from '../../plugins/github/server/routes/actions'
import { prActions } from '../../plugins/github/server/routes/prActions'
import { prCreate } from '../../plugins/github/server/routes/prCreate'
import { pullBlob } from '../../plugins/github/server/routes/pullBlob'
import { pullDetail } from '../../plugins/github/server/routes/pullDetail'
import { pullConflicts } from '../../plugins/github/server/routes/pullConflicts'
import { pullFiles } from '../../plugins/github/server/routes/pullFiles'
import { pulls } from '../../plugins/github/server/routes/pulls'
import { pullsBatch } from '../../plugins/github/server/routes/pullsBatch'
import { mentions } from '../../plugins/github/server/routes/mentions'
import { repos } from '../../plugins/github/server/routes/repos'
import { repoLabels } from '../../plugins/github/server/routes/repoLabels'
import { database } from '../../plugins/database/server/routes/database'
import { docker } from '../../plugins/docker/server/routes/docker'
import { editor } from '../../plugins/editor/server/routes/editor'
import { knowledge } from '../../plugins/memory/server/routes/knowledge'
import { localGit } from '../../plugins/changes/server/routes/localGit'
import { reviewNotes } from '../../plugins/changes/server/routes/reviewNotes'
import { search } from '../../plugins/editor/server/routes/search'
import { terminal } from '../../plugins/terminal/server/routes/terminal'
import { workflow } from '../../plugins/workflows/server/routes/workflow'

// /api/tasks/:id/* sub-resources (order-independent: distinct sub-paths under the core tasks router)
registerRoute({ prefix: '/api/tasks', router: reviewNotes, note: '/:id/review-notes (changes)' })
registerRoute({ prefix: '/api/tasks', router: search, note: '/:id/search (editor)' })
registerRoute({ prefix: '/api/tasks', router: editor, note: '/:id/editor/* (editor)' })
registerRoute({ prefix: '/api/tasks', router: localGit, note: '/:id/local/* (changes)' })
registerRoute({ prefix: '/api/tasks', router: database, note: '/:id/database/* (database)' })

// /api/docker/* — the local docker daemon surface (docker)
registerRoute({ prefix: '/api/docker', router: docker })

// /api/agents/* — account-scoped local provider usage (agents)
registerRoute({ prefix: '/api/agents', router: agentUsage })

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
