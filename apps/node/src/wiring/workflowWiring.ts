// What is LEFT of the workflow wiring after plugins/workflows became a NodePlugin: one query.
//
// `registerWorkflowIpc` — the runner construction, its fourteen RunnerDeps closures and the
// WorkflowBridge — moved into plugins/workflows/src/node/index.ts, which is also where the runner's
// `workflow_runs` / `workflow_steps` tables now live (its own SQLite file, its own migration chain).
//
// This function stays here for a specific, named reason, and it is not "we ran out of time": it reads
// github's `repos` and `checks` MIRROR tables. github is not converted, so there is no
// `github.checkState` capability for workflows to resolve and no plugin that could publish one.
//
// The tempting alternative — putting it on CoreServices — would be wrong twice over. "Are this PR's
// checks green?" is github's question: `checks` is a per-user mirror of the GitHub Checks API, refreshed
// by github's sync engine, and core has no business knowing its shape. And enshrining it as a core
// service now would guarantee moving it AGAIN the day github converts, which is exactly the one-way door
// a CoreServices member is. The app layer, by contrast, is allowed to read both packages' tables; that
// is what a composition root is for. So the query lives here and arrives at the plugin as a dep, and it
// deletes itself the moment github can publish the capability.
//
// The three-valued answer is load-bearing and is why this is not simply a boolean:
//   ''    — every mirrored check passed (the ci-loop step is done, the checks-green policy passes)
//   text  — a rendered list of the failing ones, which becomes the fix prompt
//   null  — nothing to check at all: no PR, no active identity, or the repo is not mirrored yet. The
//           ci-loop step treats this as a hard failure rather than as success.
import { and, eq } from 'drizzle-orm'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { loadTask } from '@acorn/node-core/main/taskWorktree.ts'

export async function failingChecksFor(db: AppDatabase, userId: string | null, taskId: string): Promise<string | null> {
  const t = await loadTask(db, taskId)
  if (!t || t.pullNumber == null || !userId) return null
  const [repoRow] = await db
    .select()
    .from(schema.repos)
    .where(and(eq(schema.repos.userId, userId), eq(schema.repos.owner, t.repoOwner), eq(schema.repos.name, t.repoName)))
  if (!repoRow) return null
  const rows = await db
    .select()
    .from(schema.checks)
    .where(and(eq(schema.checks.userId, userId), eq(schema.checks.repoId, repoRow.id), eq(schema.checks.number, t.pullNumber)))
  if (!rows.length) return null
  const bad = rows.filter((r) => r.status && !['success', 'neutral', 'skipped'].includes(r.status.toLowerCase()))
  return bad.length ? bad.map((r) => `- ${r.name}: ${r.status}${r.url ? ` (${r.url})` : ''}`).join('\n') : ''
}
