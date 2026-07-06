// Seed workspace notes from a task's PR + linked tickets at creation (docs/notes-and-memory.md).
// When a task is promoted from a GitHub PR we snapshot its context into discrete, user-curatable
// notes — one for the PR description, one for the comment/review thread, one per linked Linear
// ticket — each tagged with the task id so the context assembler scopes them to this task alone.
// Best-effort and idempotent per task: a failure never blocks task/worktree setup, and a re-fire
// no-ops once any note carries this task's id.
import { eq } from 'drizzle-orm'
import type { AppDatabase } from '../server/db'
import { schema } from '../server/db'
import type { NotesStore } from './notes'
import { workspaceConfigRow, type TaskRow } from './taskWorktree'

// The slices of the mirror composites we render into notes (bodies are sanitized bodyHTML / markdown).
type PrComment = { author: string | null; body: string | null; createdAt: number | null }
type PrThread = { path: string | null; line: number | null; resolved: boolean; comments: PrComment[] }
type PrReview = { author: string | null; state: string | null; body: string | null }
type PrComposite = {
  pull: { number: number; title: string; body: string | null } | null
  comments: PrComment[]
  threads: PrThread[]
  reviews: PrReview[]
}
type LinearDetail = { identifier: string; title?: string; description?: string | null }

const byCreated = (a: PrComment, b: PrComment) => (a.createdAt ?? 0) - (b.createdAt ?? 0)

// The PR conversation as one note body: review verdicts, then top-level comments, then inline
// threads (first comment is the original, the rest are replies). '' when there's nothing to say.
export function buildCommentsBody(pr: PrComposite): string {
  const sections: string[] = []
  for (const r of pr.reviews) {
    if (!r.body?.trim() && (!r.state || r.state === 'COMMENTED')) continue
    sections.push(`**Review by ${r.author ?? 'unknown'} — ${r.state ?? 'COMMENTED'}**\n\n${r.body?.trim() ?? ''}`.trim())
  }
  for (const c of [...pr.comments].sort(byCreated)) {
    if (!c.body?.trim()) continue
    sections.push(`**${c.author ?? 'unknown'}:**\n\n${c.body.trim()}`)
  }
  for (const t of pr.threads) {
    const loc = `${t.path ?? '(file)'}${t.line != null ? `:${t.line}` : ''}${t.resolved ? ' — resolved' : ''}`
    const replies = [...t.comments]
      .sort(byCreated)
      .filter((cm) => cm.body?.trim())
      .map((cm) => `- **${cm.author ?? 'unknown'}:** ${cm.body!.trim()}`)
    if (replies.length) sections.push(`**${loc}**\n\n${replies.join('\n')}`)
  }
  return sections.join('\n\n---\n\n')
}

async function fetchJson<T>(url: string, token: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'x-acorn-internal': token } })
    return res.ok ? ((await res.json()) as T) : null
  } catch {
    return null
  }
}

// Seed the PR + ticket notes for a freshly created task. Silent no-op when there's no PR/links,
// no workspace, or the task was already seeded.
export async function seedTaskNotes(db: AppDatabase, notesStore: NotesStore, internalApiEnv: Record<string, string>, task: TaskRow): Promise<void> {
  const base = internalApiEnv.ACORN_API_URL
  const token = internalApiEnv.ACORN_API_TOKEN ?? ''
  if (!base) return
  const ws = await workspaceConfigRow(db, task.repoOwner, task.repoName)
  if (!ws) return

  // Idempotency: if any note already belongs to this task, we've seeded it before — bail.
  const existing = await notesStore.list(ws.id)
  if (existing.some((n) => n.originTaskId === task.id)) return

  const seed = (title: string, body: string) => notesStore.create(ws.id, title, { author: 'user', kind: 'scratch', originTaskId: task.id, included: true, body })

  if (task.pullNumber != null) {
    // pullDetail refreshes the mirror on staleness before returning the composite (serve-then-revalidate).
    const pr = await fetchJson<PrComposite>(`${base}/api/repos/${task.repoOwner}/${task.repoName}/pulls/${task.pullNumber}`, token)
    if (pr?.pull) {
      await seed(`PR #${pr.pull.number}: ${pr.pull.title}`, pr.pull.body?.trim() || '_(no description)_')
      const comments = buildCommentsBody(pr)
      if (comments) await seed(`PR #${pr.pull.number} · Comments`, comments)
    }
  }

  const links = await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.taskId, task.id))
  for (const link of links.filter((l) => l.provider === 'linear')) {
    // refresh=1 forces a live refetch so the description is current at seed time.
    const issue = await fetchJson<LinearDetail>(`${base}/api/linear/issues/${encodeURIComponent(link.identifier)}?refresh=1`, token)
    if (issue) await seed(`${issue.identifier}: ${issue.title ?? ''}`.trim(), issue.description?.trim() || '_(no description)_')
  }
}
