import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import type { ContextBudget, ContextItem, ContextSectionResult, TaskContext } from '@acorn/protocol/api.ts'
import type { NoteAuthor, NoteScope } from '@acorn/protocol/notes.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { parseCached } from '../integrations/codec'
import { integrationProviderRegistry } from '../integrations/registry'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'

type TaskRow = typeof schema.tasks.$inferSelect
type AssembleArgs = { db: AppDatabase; userLogin: string; task: TaskRow; repo: string; workflowRunId?: string }
type ContextDraft = {
  items: ContextItem[]
  // The response adapter is intentionally separate from canonical `items`: existing task-context
  // clients still consume the top-level fields in TaskContext, while new consumers use sections.
  compatibility?: Partial<Pick<TaskContext, 'pr' | 'issues' | 'notes' | 'memory'>>
  absent?: ContextSectionResult['absent']
}

export type ContextSectionContribution = {
  id: string
  // Where this section sits in the assembled block. DECLARED by the section, not ranked by core.
  //
  // The order used to be a hardcoded `['pr','issues','notes','memory']` list in this file — core
  // sequencing four plugin-owned ids, which meant a fifth section could only ever land at the end and
  // a plugin could not say where it belonged. This is the same "sort on a declared field, never on
  // when you registered" rule the client-side pane and slot registries already follow, and the numbers
  // are spaced so a new section can slot between two without renumbering.
  //
  // The ORDER IS LOAD-BEARING, not cosmetic: every existing prompt, the client's Manifest preview and
  // the byte-exactness invariant all assume pr, issues, notes, memory. Changing a number changes what
  // an agent reads.
  order: number
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  assemble: (args: AssembleArgs) => Promise<ContextDraft>
  format: (items: ContextItem[], omitted: number, absent?: ContextSectionResult['absent']) => string
  jump?: (item: ContextItem) => ContextItem['jump']
}

export type PluginContextSection = Omit<ContextSectionContribution, 'assemble'> & {
  assemble: (args: Omit<AssembleArgs, 'db'>) => Promise<ContextDraft>
}

export type ContextNotesSource = (
  taskId: string,
  repo: string,
) => Promise<{ slug: string; scope: NoteScope; title: string; kind: string; body: string; author: NoteAuthor }[]>
export type ContextMemorySource = (taskId: string, repo: string) => Promise<{ name: string; description: string }[]>

export type ContextPullRequestSource = (
  userId: string,
  repoOwner: string,
  repoName: string,
  pullNumber: number,
) => Promise<{ number: number; title: string; body: string | null; changedFiles: string[] } | null>

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

function budgetCompatibilityProjection(
  compatibility: ContextDraft['compatibility'],
  budget: ContextBudget,
): ContextDraft['compatibility'] {
  if (!compatibility) return undefined
  const limit = budget.maxItems ?? Number.POSITIVE_INFINITY
  const result: NonNullable<ContextDraft['compatibility']> = {}
  if (compatibility.pr) result.pr = budget.maxBytesPerItem ? { ...compatibility.pr, body: compatibility.pr.body == null ? null : truncateBytes(compatibility.pr.body, budget.maxBytesPerItem) } : compatibility.pr
  if (compatibility.issues) result.issues = compatibility.issues.slice(0, limit)
  if (compatibility.notes) result.notes = compatibility.notes.slice(0, limit).map((note) => ({ ...note, body: budget.maxBytesPerItem ? truncateBytes(note.body, budget.maxBytesPerItem) : note.body }))
  if (compatibility.memory) result.memory = compatibility.memory.slice(0, limit)
  return result
}

const formatOmitted = (omitted: number) => (omitted ? `\n- … ${omitted} more omitted` : '')

// INVARIANT (relied on by the client-side Manifest preview + local send assembly, docs/ui-design.md):
// a section's `compact` MUST be computed independently of which *other* sections are included. This lets
// the client assemble the exact send block from a single `include=*` inventory by filtering ctx.sections
// and calling formatContextBlock — no second curated fetch. A new section that reads sibling inclusion
// state into its compact breaks that byte-exactness silently. Don't.

// ─── The sections ───────────────────────────────────────────────────────────────────────────────
//
// Sections are registered by the plugin or core service that owns their rows. The shared contract keeps
// budgets, compatibility projections, and wire formatting consistent for the route, manifest preview, and send
// assembly.

export function pullRequestSection(source: ContextPullRequestSource): PluginContextSection {
  return {
    id: 'pr',
    order: 10,
    label: 'Pull request',
    defaultIncluded: false,
    budget: { maxItems: 1, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
    async assemble({ userLogin, task }) {
      if (task.pullNumber == null) return { items: [] }
      const pr = await source(userLogin, task.repoOwner, task.repoName, task.pullNumber)
      if (!pr) return { items: [] }
      const changedFiles = pr.changedFiles
      const compatibility = { number: pr.number, title: pr.title, body: pr.body, changedFiles }
      return {
        items: [{ id: `pr:${pr.number}`, kind: 'PR', label: `#${pr.number} ${pr.title}`, body: pr.body ?? undefined, details: changedFiles }],
        compatibility: { pr: compatibility },
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
  }
}

// CORE's own: `task_links` and `issues` are core tables and stay core's — plugins/linear and plugins/rollbar
// write them through the ExternalItemStore seam rather than owning them (server/integrations/itemStore.ts
// states the full argument). This is also the only section that reads `db`, which is why PluginContextSection
// can withhold the handle without costing anything.
export const linkedIssuesSection: ContextSectionContribution = {
  id: 'issues',
  order: 20,
  label: 'Linked issues',
  defaultIncluded: true,
  budget: { maxItems: 50, maxBytesPerItem: 1_000, overflow: 'omit-with-marker' },
  async assemble({ db, userLogin, task }) {
    const links = (await db.select().from(schema.taskLinks).where(eq(schema.taskLinks.taskId, task.id))).sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.createdAt - b.createdAt,
    )
    const issues: TaskContext['issues'] = []
    const items: ContextItem[] = []
    const providerCounts = new Map<string, number>()
    let missing = 0
    for (const link of links) {
      const provider = integrationProviderRegistry.get(link.provider)
      const count = providerCounts.get(link.provider) ?? 0
      if (count >= (provider?.budgets.maxContextItems ?? 50)) continue
      providerCounts.set(link.provider, count + 1)
      let ref: ExternalRef = { providerId: link.provider, connectionId: link.integrationId, displayId: link.identifier }
      try {
        if (link.refJson) ref = provider?.externalIds.parse(JSON.parse(link.refJson), ref) ?? ref
      } catch {
        // Invalid refs degrade to the identifier-only fallback below.
      }
      const [row] = await db
        .select()
        .from(schema.issues)
        .where(and(eq(schema.issues.userId, userLogin), eq(schema.issues.integrationId, link.integrationId), eq(schema.issues.identifier, link.identifier)))
      const parsed = row && provider?.codec ? parseCached(provider.codec, row.data, ref) : null
      const state = !row ? 'missing' : !parsed?.ok ? 'malformed' : parsed.value.deletedAt ? 'deleted' : row.fetchedAt + (provider?.resources[0]?.ttlMs ?? 0) < Date.now() ? 'stale' : 'fresh'
      if (state === 'missing' || state === 'malformed') missing++
      const item = provider?.taskContext?.summarize(ref, parsed?.ok ? parsed.value : null, state) ?? {
        id: `${link.provider}:${link.integrationId}:${link.identifier}`,
        kind: link.provider,
        label: link.identifier,
        details: [`Cache: ${state}`],
      }
      items.push(item)
      const title = item.label.includes(' — ') ? item.label.slice(item.label.indexOf(' — ') + 3) : link.identifier
      issues.push({ provider: link.provider, identifier: link.identifier, title, detail: item.details?.[0] ?? '', cache: parsed?.ok ? 'present' : 'missing' })
    }
    return {
      items,
      compatibility: { issues },
      absent: missing ? { reason: 'missing-cache', detail: `${missing} linked item${missing === 1 ? '' : 's'} missing cached provider detail.` } : undefined,
    }
  },
  format(items, omitted, absent) {
    if (!items.length && !absent) return ''
    const lines = ['## Linked issues', ...items.map((item) => `- [${item.kind}] ${item.label}${item.details?.[0] ? ` (${item.details[0]})` : ''}`)]
    if (absent) lines.push(`- ⚠ ${absent.detail}`)
    return lines.join('\n') + formatOmitted(omitted)
  },
}

export function notesSection(source: ContextNotesSource): PluginContextSection {
  return {
    id: 'notes',
    order: 30,
    label: 'Notes',
    defaultIncluded: true,
    budget: { maxItems: 10, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
    async assemble({ task, repo, workflowRunId }) {
      const allNotes = await source(task.id, repo)
      const notes = workflowRunId
        ? allNotes.filter((note) => !note.slug.startsWith('workflow-handoffs-') || note.slug === `workflow-handoffs-${workflowRunId}`)
        : allNotes
      return {
        items: notes.map((note) => ({ id: `${note.scope}:${note.slug}`, kind: note.kind, label: note.title, body: note.body, details: [note.scope], origin: { author: note.author } })),
        compatibility: { notes: notes.map((note) => ({ slug: note.slug, scope: note.scope, title: note.title, body: note.body })) },
      }
    },
    format(items, omitted) {
      if (!items.length) return ''
      return ['## Notes', ...items.flatMap((item) => [`### ${item.label}`, item.body?.trim() ?? ''])].join('\n') + formatOmitted(omitted)
    },
    jump: (item) => ({ pane: 'notes', itemId: item.id.slice(item.id.indexOf(':') + 1), noteScope: item.id.slice(0, item.id.indexOf(':')) as NoteScope }),
  }
}

export function memorySection(source: ContextMemorySource): PluginContextSection {
  return {
    id: 'memory',
    order: 40,
    label: 'Repo memory',
    defaultIncluded: false,
    budget: { maxItems: 30, overflow: 'index-only' },
    async assemble({ task, repo }) {
      const memories = await source(task.id, repo)
      return {
        items: memories.map((memory) => ({ id: memory.name, kind: 'memory', label: memory.name, details: [memory.description] })),
        compatibility: { memory: memories },
      }
    },
    format(items, omitted) {
      if (!items.length) return ''
      return ['## Repo memory (index — ask for bodies via memory_get)', ...items.map((item) => `- ${item.label} — ${item.details?.[0] ?? ''}`)].join('\n') + formatOmitted(omitted)
    },
  }
}

// ─── The contribution point ─────────────────────────────────────────────────────────────────────

// Each section carries an owner ID. The registry rejects duplicate IDs and can remove one owner's
// contributions during service teardown or reinitialization.
type Registration = { owner: string; section: ContextSectionContribution }

class ContextSectionRegistry {
  readonly #registrations: Registration[] = []

  register(owner: string, section: ContextSectionContribution): void {
    const clash = this.#registrations.find((r) => r.section.id === section.id)
    if (clash) throw new Error(`Duplicate context section '${section.id}': already registered by '${clash.owner}', now by '${owner}'.`)
    this.#registrations.push({ owner, section })
  }

  remove(owner: string): void {
    for (let i = this.#registrations.length - 1; i >= 0; i--) {
      if (this.#registrations[i].owner === owner) this.#registrations.splice(i, 1)
    }
  }

  // ORDER IS THE WIRE ORDER of the assembled block, so it cannot be registration order.
  // Sorted on each section's DECLARED order. Ties keep registration order, because Array.sort is stable
  // — two sections claiming the same slot is a contribution the author should fix, not something for
  // this list to arbitrate.
  list(): readonly ContextSectionContribution[] {
    return this.#registrations.map((r) => r.section).sort((a, b) => a.order - b.order)
  }
}


const registry = new ContextSectionRegistry()

// Widen a plugin's `db`-less section to the registry's shape by DROPPING the handle. One helper rather
// than an inline lambda at the plugin host, so the place the handle is withheld is a named thing a reader
// can find — and so a test registering a plugin-shaped section goes through the same path production does.
export const asContextSection = (section: PluginContextSection): ContextSectionContribution => ({
  ...section,
  assemble: ({ db: _db, ...rest }) => section.assemble(rest),
})

export const registerContextSection = (owner: string, section: ContextSectionContribution): void =>
  registry.register(owner, section)
export const removeContextSections = (owner: string): void => registry.remove(owner)
export const getContextSections = (): readonly ContextSectionContribution[] => registry.list()

registerContextSection('core', linkedIssuesSection)

export function parseInclude(raw: string | undefined): Set<string> {
  const sections = registry.list()
  if (raw === '*') return new Set(sections.map((section) => section.id))
  if (!raw?.trim()) return new Set(sections.filter((section) => section.defaultIncluded).map((section) => section.id))
  const tokens = new Set(raw.split(',').map((token) => token.trim()).filter(Boolean))
  return new Set(sections.map((section) => section.id).filter((id) => tokens.has(id)))
}

export async function assembleContext(
  db: AppDatabase,
  userLogin: string,
  taskId: string,
  include: Set<string>,
  opts: { workflowRunId?: string } = {},
): Promise<TaskContext | null> {
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
  for (const contribution of registry.list()) {
    if (!include.has(contribution.id)) continue
    const draft = await contribution.assemble({ db, userLogin, task, repo, workflowRunId: opts.workflowRunId })
    const budgeted = applyBudget(draft.items, contribution.budget)
    const compatibility = budgetCompatibilityProjection(draft.compatibility, contribution.budget)
    if (compatibility) Object.assign(ctx, compatibility)
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
