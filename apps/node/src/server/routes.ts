// App-layer activation: register every plugin-owned HTTP router into the core route registry.
// This is the ONE place allowed to import both core and plugin server parts — the composition root
// imports it before createApp() runs, so core/server/index.ts never names a product route module
// (docs/plugins.md). Adding a plugin route is a one-line edit here, not a core edit.
import { registerRoute } from '@acorn/node-core/server/routeRegistry.ts'
import { agentUsage } from '@acorn/plugin-agents/server/routes/usage.ts'
import { managedAgents } from '@acorn/plugin-agents/server/routes/managed.ts'
import { actions } from '@acorn/plugin-github/server/routes/actions.ts'
import { githubDeviceAuth } from '@acorn/plugin-github/server/routes/deviceAuth.ts'
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
import { workflow } from '@acorn/plugin-workflows/server/routes/workflow.ts'

// Plugins converted to a NodePlugin register their OWN routes in init() and are absent from this
// file — see apps/node/src/server/plugins.ts for the list. This module is the remaining
// not-yet-converted half, and it shrinks to nothing as Phase 2 finishes.
//
// Every contribution mounts at /v2/p/<plugin><prefix> (docs/vNext/protocol.md § HTTP conventions).
// The prefix is the path INSIDE the plugin's namespace, so ownership is declared here rather than
// encoded in a URL: /api/tasks/:id/* was one flat table shared by core and six plugins, and the
// split below is what lets a node enable or disable a plugin's whole route surface at once.
//
// Deliberate segment doubling: one router left here states its own top-level segment internally
// (workflow's `/workflows/runs/...`), so under its namespace it repeats —
// /v2/p/workflows/workflows/runs/:runId. Converted plugins double the same way from their own init
// (memory's `/memory`). Rewriting those internal paths is the route-declaration phase's job, not this
// reshape's; terminal's was de-doubled when it converted.

// /v2/p/agents/* — account-scoped local provider usage
registerRoute({ plugin: 'agents', prefix: '', router: agentUsage })
registerRoute({ plugin: 'agents', prefix: '', router: managedAgents })

// Namespace-root router: owns a mix of task-scoped and top-level paths (see the doubling note)
registerRoute({ plugin: 'workflows', prefix: '', router: workflow, note: 'workflow control' })

// /v2/p/github/repos/* — the GitHub mirror; device-flow connect sits beside it at /auth/*
registerRoute({ plugin: 'github', prefix: '/repos', router: repos })
registerRoute({ plugin: 'github', prefix: '/repos', router: repoLabels, note: '/:owner/:repo/labels' })
registerRoute({ plugin: 'github', prefix: '/repos', router: pulls })
registerRoute({ plugin: 'github', prefix: '/repos', router: pullDetail })
registerRoute({ plugin: 'github', prefix: '/repos', router: pullConflicts, note: '/:owner/:repo/pulls/:number/conflicts' })
registerRoute({ plugin: 'github', prefix: '/repos', router: pullFiles })
registerRoute({ plugin: 'github', prefix: '/repos', router: pullBlob })
registerRoute({ plugin: 'github', prefix: '/repos', router: pullsBatch })
registerRoute({ plugin: 'github', prefix: '/repos', router: prActions })
registerRoute({ plugin: 'github', prefix: '/repos', router: actions })
registerRoute({ plugin: 'github', prefix: '/repos', router: prCreate })
registerRoute({ plugin: 'github', prefix: '/repos', router: mentions })
registerRoute({ plugin: 'github', prefix: '', router: githubDeviceAuth, note: '/auth/device/* — OAuth device-flow connect' })

// Provider-owned HTTP routers (linear/rollbar) are registered in app/server/providers.ts via the
// integration provider registry, mounted at /v2/p/<providerId> through
// buildIntegrationProviderRoutes() in createApp().
