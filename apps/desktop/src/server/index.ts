import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { integrationProviderRoutes } from './integrations/providerRoutes'
import { requireUser } from './middleware/requireUser'
import { onServerError } from './respond'
import { actions } from './routes/actions'
import { auth } from './routes/auth'
import { integrations } from './routes/integrations'
import { me } from './routes/me'
import { pins } from './routes/pins'
import { prActions } from './routes/prActions'
import { prCreate } from './routes/prCreate'
import { prefs } from './routes/prefs'
import { pullBlob } from './routes/pullBlob'
import { pullDetail } from './routes/pullDetail'
import { pullFiles } from './routes/pullFiles'
import { pulls } from './routes/pulls'
import { pullsBatch } from './routes/pullsBatch'
import { mentions } from './routes/mentions'
import { repos } from './routes/repos'
import { repoLabels } from './routes/repoLabels'
import { database } from './routes/database'
import { editor } from './routes/editor'
import { knowledge } from './routes/knowledge'
import { localGit } from './routes/localGit'
import { reviewNotes } from './routes/reviewNotes'
import { search } from './routes/search'
import { terminal } from './routes/terminal'
import { workflow } from './routes/workflow'
import { harness } from './routes/harness'
import { agentTools, agentToolsCatalog } from './routes/agentTools'
import { taskContext } from './routes/taskContext'
import { workspaces } from './routes/workspaces'
import { tasks } from './routes/tasks'

// One server, both /auth and /api. The Node/Electron bootstrap (main/server.ts) wraps this with
// static asset serving + SPA fallback. createApp() is a factory so the bootstrap can build a fresh
// instance without mutating the default export that tests use.
export function createApp() {
  // Mount order is the auth invariant: /auth is public (it establishes the session), then every
  // /api/* request passes csrf → authMiddleware (resolve principal) → requireUser (enforce it)
  // before any router. A router mounted before requireUser would be an unauthenticated hole, so
  // all /api routers stay below this line. See docs/next/security.md §3.
  return new Hono<AppEnv>()
    .route('/auth', auth)
    .use('/api/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
    .use('/api/*', authMiddleware) // resolve ctx.principal from cookie or internal token
    .use('/api/*', requireUser) // single 401 gate over the protected router table
    .route('/api/me', me)
    .route('/api/pins', pins)
    .route('/api/prefs', prefs)
    .route('/api/workspaces', workspaces)
    .route('/api/tasks', tasks)
    .route('/api/tasks', reviewNotes) // /:id/review-notes — local inline notes (docs/panes.md)
    .route('/api/tasks', taskContext) // /:id/context — the assembled task context (docs/next 11 §C)
    .route('/api/tasks', search) // /:id/search — find-in-files over the worktree (docs/panes.md)
    .route('/api/tasks', editor) // /:id/editor/* — read/write/list worktree files (docs/workspaces)
    .route('/api/tasks', localGit) // /:id/local/* — working-tree review + stage/commit (docs/panes.md)
    .route('/api/tasks', database) // /:id/database/* — per-task Postgres browse/edit (docs/pg.md)
    .route('/api/tasks', harness) // /:id/run — the renderer's run-target surface (docs/next 13 §A)
    .route('/api/tasks', agentTools) // /:id/tools + /:id/tools/:name — the agent-tool registry projection (docs/agent-tools.md)
    .route('/api/agent-tools', agentToolsCatalog) // static tool catalog for the permissions settings page
    .route('/api', workflow) // /tasks/:id/workflows + /workflows/runs/:runId/* — workflow control (docs/next 14)
    .route('/api', knowledge) // /memory* + /workspaces/:wsId/notes* — the notes/memory pane surface (docs/notes-and-memory.md)
    .route('/api', terminal) // /terminal/* + /tasks/:id/{archive,preview-url,mcp,…} — terminal control (docs/terminal-and-agents.md)
    .route('/api/integrations', integrations) // connect/disconnect/status for third-party providers
    .route('/api', integrationProviderRoutes) // provider-owned routes projected from the integration registry
    .route('/api/repos', repos)
    .route('/api/repos', repoLabels) // /:owner/:repo/labels — repo label choices for the PR picker
    .route('/api/repos', pulls) // repo-scoped sub-resources, e.g. /:owner/:repo/pulls
    .route('/api/repos', pullDetail) // /:owner/:repo/pulls/:number
    .route('/api/repos', pullFiles) // /:owner/:repo/pulls/:number/files
    .route('/api/repos', pullBlob) // /:owner/:repo/blobs/:sha — full body for context expansion
    .route('/api/repos', pullsBatch) // POST /:owner/:repo/pulls/batch — prefetch warm-up
    .route('/api/repos', prActions) // PR write actions: merge / close / reopen / draft / comments
    .route('/api/repos', actions) // Actions reads: /:owner/:repo/actions/runs/:runId/jobs + jobs/:jobId/logs
    .route('/api/repos', prCreate) // create PR + branches/compare reads for the create view
    .route('/api/repos', mentions) // /:owner/:repo/mentions — participant logins for @autocomplete
    .onError(onServerError) // uncaught throws still speak ApiError on /api (docs/api-reference.md §error-codes)
}

export default createApp()
