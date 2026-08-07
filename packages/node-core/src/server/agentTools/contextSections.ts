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

// What a PLUGIN registers. Identical except that `assemble` never sees `db`.
//
// That omission is the point, not a convenience. `AssembleArgs.db` is core's own handle, and handing it to
// a plugin would re-open exactly what Phase 2's database split closed — a plugin reading tables that no
// longer live in its file. It costs nothing to withhold: of the four sections that exist, only core's own
// `issues` touches `db` at all, and the three that moved out (`pr`, `notes`, `memory`) read nothing but
// `task`, `repo`, `userLogin` and `workflowRunId`. A plugin section that finds it needs a core query wants
// a CoreServices call, not this handle.
export type PluginContextSection = Omit<ContextSectionContribution, 'assemble'> & {
  assemble: (args: Omit<AssembleArgs, 'db'>) => Promise<ContextDraft>
}

export type ContextNotesSource = (
  taskId: string,
  repo: string,
) => Promise<{ slug: string; scope: NoteScope; title: string; kind: string; body: string; author: NoteAuthor }[]>
export type ContextMemorySource = (taskId: string, repo: string) => Promise<{ name: string; description: string }[]>

// The `pr` section's source, injected for the same reason `notes` and `memory` already were: the data
// lives in a plugin's own SQLite file and core has no handle to it. github's mirror moved out of core's
// schema in Phase 2, so the section that used to join `repos ⋈ pull_requests ⋈ pr_files` here now asks
// the plugin (plugins/github/src/contract/mirror.ts § pullRequest).
//
// `null` covers three cases the section must render identically — no PR on the task, the repo is not
// mirrored, the PR is not cached yet — and one more the injected form adds: github disabled entirely.
// All four produce an empty section rather than an error, which is what the section did before.
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

// INVARIANT (relied on by the client-side Manifest preview + local send assembly, docs/next/context-ui.md):
// a section's `compact` MUST be computed independently of which *other* sections are included. This lets
// the client assemble the exact send block from a single `include=*` inventory by filtering ctx.sections
// and calling formatContextBlock — no second curated fetch. A new section that reads sibling inclusion
// state into its compact breaks that byte-exactness silently. Don't.

// ─── The sections ───────────────────────────────────────────────────────────────────────────────
//
// Four builders where there was one `buildContextSections({ notes, memory, pullRequest })`. The split is
// by DATA OWNER: `issues` reads core's own `task_links` and `issues` tables, so it stays core's; the other
// three read a plugin's SQLite file through that plugin's capability, so each is registered by the plugin
// that owns the rows (plugins/github, plugins/notes, plugins/memory).
//
// What deliberately did NOT move is the section CONTRACT — `budget`, the `legacy` projection and `format`.
// Those decide the assembled block's bytes, the invariant above depends on them being computed one way, and
// every consumer reads them: the route, the client's Manifest preview, the local send assembly. A plugin
// owns where rows come from; core owns what a section looks like on the wire.

export function pullRequestSection(source: ContextPullRequestSource): PluginContextSection {
  return {
    id: 'pr',
    label: 'Pull request',
    defaultIncluded: false,
    budget: { maxItems: 1, maxBytesPerItem: 2_000, overflow: 'truncate-tail' },
    async assemble({ userLogin, task }) {
      if (task.pullNumber == null) return { items: [] }
      // The three-table join this used to run against core's database is one capability call into
      // plugins/github (which sorts the changed-file list, as the join's ORDER did).
      const pr = await source(userLogin, task.repoOwner, task.repoName, task.pullNumber)
      if (!pr) return { items: [] }
      const changedFiles = pr.changedFiles
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
  }
}

// CORE's own: `task_links` and `issues` are core tables and stay core's — plugins/linear and plugins/rollbar
// write them through the ExternalItemStore seam rather than owning them (server/integrations/itemStore.ts
// states the full argument). This is also the only section that reads `db`, which is why PluginContextSection
// can withhold the handle without costing anything.
export const linkedIssuesSection: ContextSectionContribution = {
  id: 'issues',
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
}

export function notesSection(source: ContextNotesSource): PluginContextSection {
  return {
    id: 'notes',
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
        legacy: { notes: notes.map((note) => ({ slug: note.slug, scope: note.scope, title: note.title, body: note.body })) },
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
    label: 'Repo memory',
    defaultIncluded: false,
    budget: { maxItems: 30, overflow: 'index-only' },
    async assemble({ task, repo }) {
      const memories = await source(task.id, repo)
      return {
        items: memories.map((memory) => ({ id: memory.name, kind: 'memory', label: memory.name, details: [memory.description] })),
        legacy: { memory: memories },
      }
    },
    format(items, omitted) {
      if (!items.length) return ''
      return ['## Repo memory (index — ask for bodies via memory_get)', ...items.map((item) => `- ${item.label} — ${item.details?.[0] ?? ''}`)].join('\n') + formatOmitted(omitted)
    },
  }
}

// ─── The contribution point ─────────────────────────────────────────────────────────────────────

// Was `setContextSections(buildContextSections({ notes, memory, pullRequest }))`: ONE slot that had to be
// filled with every source at once, which meant apps/node/src/wiring/contextSectionsWiring.ts was the only
// place allowed to hold three different plugins' seams — and so neither notes nor memory could own its own
// half. That file is gone; each plugin registers its own section in its own `init`.
//
// Same shape as AgentToolRegistry above, for the same three reasons: an owner id so a contribution can be
// REMOVED as a unit, a duplicate-id throw rather than last-write-wins (two sections under one id would
// resolve by plugin init order, which host.ts explicitly refuses to make load-bearing), and a `remove` the
// plugin host calls before re-registering, because a process that starts the service twice would otherwise
// keep sections closed over the first boot's handles.
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

  // ORDER IS THE WIRE ORDER of the assembled block, so it cannot be registration order: `pr`, `issues`,
  // `notes`, `memory` is what every existing prompt, the client's Manifest preview and the byte-exactness
  // invariant above all assume. Sections sort on this list, and anything unlisted follows in registration
  // order — the same "sort on a declared field, never on when you registered" rule the client-side pane and
  // slot registries follow.
  list(): readonly ContextSectionContribution[] {
    const rank = (id: string) => {
      const index = SECTION_ORDER.indexOf(id)
      return index === -1 ? SECTION_ORDER.length : index
    }
    return this.#registrations.map((r) => r.section).sort((a, b) => rank(a.id) - rank(b.id))
  }
}

const SECTION_ORDER = ['pr', 'issues', 'notes', 'memory']

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

// Core's own section, registered HERE at module scope — beside the registry, the assembler that reads it and
// the route that serves it, rather than from a composition-root wiring file.
//
// It used to be registered by apps/node/src/wiring/agentToolsWiring.ts, which is reached only from
// apps/node/src/service/runtime.ts. apps/node/src/server/standalone.ts calls `initPlugins` and never
// `wireAgentTools`, so on a standalone node — `pnpm dev:node`, and per that file's own header the node a
// client pairs with over the LAN — the Linked-issues row silently vanished from the context pane, from the
// assembled send block and from the launch injector. Nothing errored; a section simply was not there. Before
// Phase 3 this registry self-seeded a default list of all four sections, so the regression arrived WITH the
// per-owner contribution point, and pluginDisable.test.ts then baked the three-section result in as its
// expected baseline.
//
// Module scope is right for this one and only this one: `issues` reads `task_links` and `issues`, core's own
// tables, through the `db` handle `assemble` is already given — so it closes over no dependency, needs no
// boot ordering, and is the same object on every boot. A plugin's section cannot do this, because it closes
// over that plugin's own SQLite handle, which is exactly why the other three stay in their plugin's `init`.
//
// The `removeContextSections('core')` that sat beside the old registration is deliberately NOT carried over,
// and this is the one place where "move it too" would have been wrong. Its job was idempotence for a process
// that boots the service more than once (service/runtime.test.ts does it four times): a per-boot registration
// has to clear the previous boot's entry or the duplicate-id guard fails the second boot. A module body runs
// once per module instance, so there is nothing to clear — the line would be a permanent no-op documenting a
// problem that no longer exists. The multi-boot property comes free instead.
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
