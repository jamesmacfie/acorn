import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { authMiddleware, type AppEnv } from './middleware/auth'
import { actions } from './routes/actions'
import { auth } from './routes/auth'
import { integrations, linear } from './routes/integrations'
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
import { workspaces } from './routes/workspaces'
import { tasks } from './routes/tasks'

// One server, both /auth and /api. The Node/Electron bootstrap (main/server.ts) wraps this with
// static asset serving + SPA fallback. createApp() is a factory so the bootstrap can build a fresh
// instance without mutating the default export that tests use.
export function createApp() {
  return new Hono<AppEnv>()
    .route('/auth', auth)
    .use('/api/*', csrf()) // Origin / Sec-Fetch-Site check on mutating calls
    .use('/api/*', authMiddleware) // stateless cookie → ctx.user (stub for now)
    .route('/api/me', me)
    .route('/api/pins', pins)
    .route('/api/prefs', prefs)
    .route('/api/workspaces', workspaces)
    .route('/api/tasks', tasks)
    .route('/api/integrations', integrations) // connect/disconnect/status for third-party providers
    .route('/api/linear', linear) // Linear issues referenced from a PR (read, cached per-user)
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
}

export default createApp()
