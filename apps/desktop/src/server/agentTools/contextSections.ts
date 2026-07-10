import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import type { ContextBudget, ContextItem, ContextSectionResult, TaskContext } from '../../shared/api'
import type { NoteScope } from '../../shared/notes'
import type { AppDatabase } from '../db'
import { schema } from '../db'

type TaskRow = typeof schema.tasks.$inferSelect
type AssembleArgs = { db: AppDatabase; userLogin: string; task: TaskRow; repo: string }
type ContextDraft = {
  items: ContextItem[]
  legacy?: Partial<Pick<TaskContext, 'pr' | 'issues' | 'notes' | 'memory'>>
  absent?: ContextSectionResult['absent']
}

export type ContextSectionContribution = {
  id: string
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  assemble: (args: AssembleArgs) => Promise<ContextDraft>
  format: (items: ContextItem[], omitted: number, absent?: ContextSectionResult['absent']) => string
  jump?: (item: ContextItem) => ContextItem['jump']
}

export type ContextNotesSource = (
  taskId: string,
  repo: string,
) => Promise<{ slug: string; scope: NoteScope; title: string; kind: string; body: string }[]>
export type ContextMemorySource = (taskId: string, repo: string) => Promise<{ name: string; description: string }[]>

const truncateBytes = (value: string, max: number): string => {
  if (Buffer.byteLength(value, 'utf8') <= max) return value
  let bytes = Buffer.from(value, 'utf8').subarray(0, Math.max(0, max - Buffer.byteLength('…')))
  let text = bytes.toString('utf8')
  while (text.endsWith('�') && bytes.length) {
    bytes = bytes.subarray(0, -1)
    text = bytes.toString('utf8')
  }
  return `${text}…`
}

function applyBudget(items: ContextItem[], budget: ContextBudget): { items: ContextItem[]; omitted: number } {
  const limit = budget.maxItems ?? items.length
  const omitted = Math.max(0, items.length - limit)
  return {
    omitted,
    items: items.slice(0, limit).map((item) => {
      if (budget.overflow === 'index-only') return { ...item, body: undefined }
      if (!budget.maxBytesPerItem) return item
      return {
        ...item,
        body: item.body == null ? undefined : truncateBytes(item.body, budget.maxBytesPerItem),
        details: item.details?.map((detail) => truncateBytes(detail, budget.maxBytesPerItem!)),
      }
    }),
  }
}

function budgetLegacy(
  legacy: ContextDraft['legacy'],
  budget: ContextBudget,
): ContextDraft['legacy'] {
  if (!legacy) return undefined
  const limit = budget.maxItems ?? Number.POSITIVE_INFINITY
  const result: NonNullable<ContextDraft['legacy']> = {}
  if (legacy.pr) result.pr = budget.maxBytesPerItem ? { ...legacy.pr, body: legacy.pr.body == null ? null : truncateBytes(legacy.pr.body, budget.maxBytesPerItem) } : legacy.pr
  if (legacy.issues) result.issues = legacy.issues.slice(0, limit)
  if (legacy.notes) result.notes = legacy.notes.slice(0, limit).map((note) => ({ ...note, body: budget.maxBytesPerItem ? truncateBytes(note.body, budget.maxBytesPerItem) : note.body }))
  if (legacy.memory) result.memory = legacy.memory.slice(0, limit)
  return result
}

const formatOmitted = (omitted: number) => (omitted ? `\n- … ${omitted} more omitted` : '')

export function buildContextSections(sources: { notes: ContextNotesSource; memory: ContextMemorySource }): ContextSectionContribution[] {
  return [
    {
      id: 'pr',
      label: 'Pull request',
      defaultIncluded: false,
      budget: { maxItems: 1, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
      async assemble({ db, userLogin, task }) {
        if (task.pullNumber == null) return { items: [] }
        const [repoRow] = await db
          .select()
          .from(schema.repos)
          .where(and(eq(schema.repos.userId, userLogin), eq(schema.repos.owner, task.repoOwner), eq(schema.repos.name, task.repoName)))
        if (!repoRow) return { items: [] }
        const [pr] = await db
          .select()
          .from(schema.pullRequests)
          .where(and(eq(schema.pullRequests.userId, userLogin), eq(schema.pullRequests.repoId, repoRow.id), eq(schema.pullRequests.number, task.pullNumber)))
        if (!pr) return { items: [] }
        const files = await db
          .select({ path: schema.prFiles.path })
          .from(schema.prFiles)
          .where(and(eq(schema.prFiles.userId, userLogin), eq(schema.prFiles.repoId, repoRow.id), eq(schema.prFiles.number, task.pullNumber)))
        const changedFiles = files.map((file) => file.path).sort()
        const legacy = { number: pr.number, title: pr.title, body: pr.body, changedFiles }
        return {
          items: [{ id: `pr:${pr.number}`, kind: 'PR', label: `#${pr.number} ${pr.title}`, body: pr.body ?? undefined, details: changedFiles }],
          legacy: { pr: legacy },
        }
      },
      format(items) {
        const item = items[0]
        if (!item) return ''
        const lines = [`## PR ${item.label}`]
        const body = item.body?.replace(/<[^>]+>/g, '').trim()
        if (body) lines.push(truncateBytes(body, 600))
        const files = item.details ?? []
        if (files.length) {
          const shown = files.slice(0, 30)
          const more = files.length - shown.length
          lines.push(`Changed files (${files.length}): ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}`)
        }
        return lines.join('\n')
      },
    },
    {
      id: 'issues',
      label: 'Linked issues',
      defaultIncluded: false,
      budget: { maxItems: 50, maxBytesPerItem: 1_000, overflow: 'omit-with-marker' },
      async assemble({ db, userLogin, task }) {
        const links = await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.taskId, task.id)).orderBy(schema.taskLinks.createdAt)
        const issues: TaskContext['issues'] = []
        let missing = 0
        for (const link of links) {
          const [row] = await db
            .select()
            .from(schema.issues)
            .where(and(eq(schema.issues.userId, userLogin), eq(schema.issues.integrationId, link.integrationId), eq(schema.issues.identifier, link.identifier)))
          let title = link.identifier
          let detail = ''
          let cache: 'present' | 'missing' = row ? 'present' : 'missing'
          if (row) {
            try {
              const data = JSON.parse(row.data) as { title?: string; state?: { name?: string }; status?: string; level?: string }
              if (typeof data.title === 'string' && data.title) title = data.title
              detail = data.state?.name ?? data.status ?? data.level ?? ''
            } catch {
              // Malformed cached data is explicit below, like a missing cache row.
              missing++
              cache = 'missing'
            }
          } else {
            missing++
          }
          issues.push({ provider: link.provider, identifier: link.identifier, title, detail, cache })
        }
        return {
          items: issues.map((issue) => ({
            id: `${issue.provider}:${issue.identifier}`,
            kind: issue.provider,
            label: `${issue.identifier} — ${issue.title}`,
            details: [issue.detail, issue.cache === 'missing' ? 'Cached provider detail is unavailable.' : ''].filter(Boolean),
          })),
          legacy: { issues },
          absent: missing ? { reason: 'missing-cache', detail: `${missing} linked item${missing === 1 ? '' : 's'} missing cached provider detail.` } : undefined,
        }
      },
      format(items, omitted, absent) {
        if (!items.length && !absent) return ''
        const lines = ['## Linked issues', ...items.map((item) => `- [${item.kind}] ${item.label}${item.details?.[0] ? ` (${item.details[0]})` : ''}`)]
        if (absent) lines.push(`- ⚠ ${absent.detail}`)
        return lines.join('\n') + formatOmitted(omitted)
      },
    },
    {
      id: 'notes',
      label: 'Notes',
      defaultIncluded: true,
      budget: { maxItems: 10, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
      async assemble({ task, repo }) {
        const notes = await sources.notes(task.id, repo)
        return {
          items: notes.map((note) => ({ id: `${note.scope}:${note.slug}`, kind: note.kind, label: note.title, body: note.body, details: [note.scope] })),
          legacy: { notes: notes.map((note) => ({ slug: note.slug, scope: note.scope, title: note.title, body: note.body })) },
        }
      },
      format(items, omitted) {
        if (!items.length) return ''
        return ['## Notes', ...items.flatMap((item) => [`### ${item.label}`, item.body?.trim() ?? ''])].join('\n') + formatOmitted(omitted)
      },
      jump: (item) => ({ pane: 'notes', itemId: item.id.slice(item.id.indexOf(':') + 1), noteScope: item.id.slice(0, item.id.indexOf(':')) as NoteScope }),
    },
    {
      id: 'memory',
      label: 'Repo memory',
      defaultIncluded: false,
      budget: { maxItems: 30, overflow: 'index-only' },
      async assemble({ task, repo }) {
        const memories = await sources.memory(task.id, repo)
        return {
          items: memories.map((memory) => ({ id: memory.name, kind: 'memory', label: memory.name, details: [memory.description] })),
          legacy: { memory: memories },
        }
      },
      format(items, omitted) {
        if (!items.length) return ''
        return ['## Repo memory (index — ask for bodies via memory_get)', ...items.map((item) => `- ${item.label} — ${item.details?.[0] ?? ''}`)].join('\n') + formatOmitted(omitted)
      },
    },
  ]
}

let registry = buildContextSections({ notes: async () => [], memory: async () => [] })

export function setContextSections(sections: ContextSectionContribution[]): void {
  const ids = new Set<string>()
  for (const section of sections) {
    if (ids.has(section.id)) throw new Error(`Duplicate context section '${section.id}'.`)
    ids.add(section.id)
  }
  registry = sections
}

export const getContextSections = (): readonly ContextSectionContribution[] => registry

export function parseInclude(raw: string | undefined): Set<string> {
  if (raw === '*') return new Set(registry.map((section) => section.id))
  if (!raw?.trim()) return new Set(registry.filter((section) => section.defaultIncluded).map((section) => section.id))
  const tokens = new Set(raw.split(',').map((token) => token.trim()).filter(Boolean))
  return new Set(registry.map((section) => section.id).filter((id) => tokens.has(id)))
}

export async function assembleContext(db: AppDatabase, userLogin: string, taskId: string, include: Set<string>): Promise<TaskContext | null> {
  const [task] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId))
  if (!task) return null
  const repo = `${task.repoOwner}/${task.repoName}`
  const ctx: TaskContext = {
    task: { id: task.id, title: task.title, repo, branch: task.branch, worktreePath: task.worktreePath, pullNumber: task.pullNumber },
    sections: [],
    issues: [],
    notes: [],
    memory: [],
  }
  for (const contribution of registry) {
    if (!include.has(contribution.id)) continue
    const draft = await contribution.assemble({ db, userLogin, task, repo })
    const budgeted = applyBudget(draft.items, contribution.budget)
    const legacy = budgetLegacy(draft.legacy, contribution.budget)
    if (legacy) Object.assign(ctx, legacy)
    const items = budgeted.items.map((item) => ({ ...item, jump: contribution.jump?.(item) }))
    ctx.sections.push({
      id: contribution.id,
      label: contribution.label,
      defaultIncluded: contribution.defaultIncluded,
      budget: contribution.budget,
      items,
      compact: contribution.format(items, budgeted.omitted, draft.absent),
      omitted: budgeted.omitted,
      absent: draft.absent,
    })
  }
  return ctx
}
