import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { generateOpenApi } from '../../src/core/server/publicApi/openapi'
import type { AnyEndpoint } from '../../src/core/server/publicApi/defineEndpoint'
import { LocalGitService } from '../../src/plugins/changes/main/localGitService'
import { buildChangesPublicApi } from '../../src/plugins/changes/server/publicApi'
import type { DatabaseBridge } from '../../src/plugins/database/server/routes/database'
import { buildDatabasePublicApi } from '../../src/plugins/database/server/publicApi'
import { GitHubPublicService } from '../../src/plugins/github/server/publicService'
import { buildGithubPublicApi } from '../../src/plugins/github/server/publicApi'
import { editorBridge } from '../../src/plugins/editor/main/editor'
import { searchBridge } from '../../src/plugins/editor/main/search'
import { buildEditorPublicApi } from '../../src/plugins/editor/server/publicApi'
import { MemoryProposalStore } from '../../src/plugins/memory/main/memoryProposals'
import { MemoryService } from '../../src/plugins/memory/main/memoryService'
import { buildMemoryPublicApi } from '../../src/plugins/memory/server/publicApi'
import { LinearService } from '../../src/plugins/linear/server/linearService'
import { buildLinearPublicApi } from '../../src/plugins/linear/server/publicApi'
import { NotesStore } from '../../src/plugins/notes/main/notes'
import { buildNotesPublicApi } from '../../src/plugins/notes/server/publicApi'
import { buildRollbarPublicApi } from '../../src/plugins/rollbar/server/publicApi'
import { RepoCheckoutService } from '../../src/plugins/terminal/main/checkoutService'
import { TerminalProfilesService } from '../../src/plugins/terminal/main/profilesService'
import { TerminalSessionService } from '../../src/plugins/terminal/main/sessionService'
import { CommandExecutionService } from '../../src/plugins/terminal/main/executionService'
import { WorktreeService } from '../../src/plugins/terminal/main/worktreeService'
import { buildTerminalPublicApi } from '../../src/plugins/terminal/server/publicApi'
import { buildRunTargetsContribution } from '../../src/plugins/terminal/server/runTargets'
import { WorkflowService, type WorkflowRunnerLike } from '../../src/plugins/workflows/main/workflowService'
import { buildWorkflowsPublicApi } from '../../src/plugins/workflows/server/publicApi'
import { makeTestDb, type TestDb } from '../../src/core/server/routes/testDb'
import { fillPath, makeHarness, type Harness } from './harness'

// Shared conformance suite (docs/next/api/implementation-plan.md §12 "Route conformance"). Cases are
// generated from the frozen registry, so every endpoint — core and every built-in plugin — is
// exercised for auth-gating, scope, and OpenAPI presence without a bespoke test.

let h: Harness
let notesDir: string
let gitDb: TestDb
beforeAll(async () => {
  notesDir = mkdtempSync(join(tmpdir(), 'acorn-conf-notes-'))
  gitDb = makeTestDb()
  const memProposals = new MemoryProposalStore(mkdtempSync(join(tmpdir(), 'acorn-conf-prop-')))
  const wfRunnerStub: WorkflowRunnerLike = {
    start: async () => '00000000-0000-4000-8000-000000000000',
    resolveGate: async () => {},
    cancelRun: async () => {},
    killStep: async () => {},
    pollTriggers: async () => ({ started: 0, errors: [] }),
  }
  const dbStub: DatabaseBridge = {
    connect: async () => ({ ok: true, database: 'db' }),
    disconnect: async () => ({ ok: true }),
    tables: async () => ({ tables: [] }),
    columns: async () => ({ columns: [] }),
    rows: async () => ({ columns: [], rows: [], rowCount: 0, command: 'SELECT', total: 0 }),
    query: async () => ({ columns: [], rows: [], rowCount: 0, command: 'SELECT', ms: 0 }),
    insert: async () => ({ ok: true, rowCount: 0 }),
    update: async () => ({ ok: true, rowCount: 0 }),
    remove: async () => ({ ok: true, rowCount: 0 }),
  }
  h = await makeHarness([
    { owner: 'notes', contribution: buildNotesPublicApi(new NotesStore(notesDir)) },
    { owner: 'changes', contribution: buildChangesPublicApi(new LocalGitService(gitDb.db)) },
    { owner: 'editor', contribution: buildEditorPublicApi(editorBridge(gitDb.db), searchBridge(gitDb.db)) },
    { owner: 'memory', contribution: buildMemoryPublicApi(new MemoryService({ db: gitDb.db, proposals: memProposals, reconcile: async () => {} })) },
    { owner: 'database', contribution: buildDatabasePublicApi(dbStub) },
    { owner: 'workflows', contribution: buildWorkflowsPublicApi(new WorkflowService(gitDb.db, wfRunnerStub)) },
    { owner: 'rollbar', contribution: buildRollbarPublicApi(gitDb.db, '0'.repeat(64)) },
    { owner: 'linear', contribution: buildLinearPublicApi(new LinearService(gitDb.db, '0'.repeat(64))) },
    { owner: 'terminal', contribution: buildTerminalPublicApi(new CommandExecutionService(gitDb.db), new WorktreeService(gitDb.db), new RepoCheckoutService(gitDb.db), new TerminalProfilesService(), new TerminalSessionService()) },
    { owner: 'terminal', contribution: buildRunTargetsContribution() },
    { owner: 'github', contribution: buildGithubPublicApi(new GitHubPublicService({ db: gitDb.db, blobs: { get: async () => null }, resolveToken: async () => null })) },
  ])
})
afterAll(() => {
  h.cleanup()
  gitDb.cleanup()
  rmSync(notesDir, { recursive: true, force: true })
})

function fullPath(e: AnyEndpoint): string {
  const rel = e.pluginId === 'core' ? e.path : `/plugins/${e.pluginId}${e.path}`
  return fillPath(`/api/v1${rel}`)
}

describe('public API conformance', () => {
  it('registers at least the core system + resource surface', () => {
    expect(h.snapshot.endpoints.length).toBeGreaterThanOrEqual(15)
  })

  it('every endpoint rejects a missing bearer with 401', async () => {
    for (const e of h.snapshot.endpoints) {
      const res = await h.request(fullPath(e), { method: e.method })
      expect(res.status, `${e.method} ${e.operationId}`).toBe(401)
      expect(res.headers.get('www-authenticate'), e.operationId).toContain('invalid_token')
    }
  })

  it('every write endpoint rejects a read-only token with 403 insufficient_scope', async () => {
    for (const e of h.snapshot.endpoints.filter((e) => e.scope === 'write')) {
      const res = await h.request(fullPath(e), { method: e.method }, h.readToken)
      expect(res.status, `${e.method} ${e.operationId}`).toBe(403)
      expect((await res.json()).error.code, e.operationId).toBe('insufficient_scope')
    }
  })

  it('every read endpoint passes auth+scope for a read token (not 401/403)', async () => {
    for (const e of h.snapshot.endpoints.filter((e) => e.scope === 'read')) {
      const res = await h.request(fullPath(e), { method: e.method }, h.readToken)
      expect([401, 403], `${e.method} ${e.operationId} → ${res.status}`).not.toContain(res.status)
    }
  })

  it('every endpoint appears in the generated OpenAPI document', () => {
    const doc = generateOpenApi(h.snapshot) as { paths: Record<string, Record<string, unknown>> }
    for (const e of h.snapshot.endpoints) {
      const rel = e.pluginId === 'core' ? e.path : `/plugins/${e.pluginId}${e.path}`
      const oaPath = `/api/v1${rel}`.replace(/:([A-Za-z0-9_]+)/g, '{$1}')
      expect(doc.paths[oaPath]?.[e.method.toLowerCase()], e.operationId).toBeDefined()
    }
  })

  it('no error response leaks a token/secret field', async () => {
    // A malformed request to a write endpoint returns an error envelope only.
    const res = await h.request('/api/v1/tasks', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': 'c1' },
      body: JSON.stringify({ bogus: true }),
    }, h.writeToken)
    expect(res.status).toBe(422)
    const text = await res.text()
    expect(text).not.toContain('secretHash')
    expect(text).not.toContain(h.writeToken)
  })
})
