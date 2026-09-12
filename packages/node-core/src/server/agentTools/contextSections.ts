import { Buffer } from 'node:buffer'
import { and, eq } from 'drizzle-orm'
import type { ContextBudget, ContextItem, ContextSectionResult, TaskContext } from '@acorn/protocol/api.ts'
import type { AppDatabase } from '../db'
import { schema } from '../db'
import { runHook } from '../pluginHost/hooks'
import { parseCached } from '../integrations/codec'
import { integrationProviderRegistry } from '../integrations/registry'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { MAX_AGENT_CONTEXT_BYTES } from '@acorn/protocol/agentContext.ts'

type TaskRow = typeof schema.tasks.$inferSelect
type AssembleArgs = { db: AppDatabase; userLogin: string; task: TaskRow; repo: string; github: { owner: string; name: string } | null; workflowRunId?: string }
type ContextDraft = {
  items: ContextItem[]
  // A descriptor may carry already-formatted reference text. Compiled contributions normally leave
  // this absent and use their pure `format` function below.
  compact?: string
  // Kept separate from canonical `items` (docs/agent-tools.md § Context sections).
  compatibility?: Partial<Pick<TaskContext, 'pr' | 'issues' | 'notes' | 'memory'>>
  absent?: ContextSectionResult['absent']
  // A loaded section may have truncated at its own data source before the host sees its bounded list.
  // Core adds this to anything omitted by the registry budget.
  omitted?: number
}

export class ContextSectionAssemblyError extends Error {
  constructor(readonly reason: 'unavailable' | 'timeout' | 'invalid-response', message: string) {
    super(message)
    this.name = 'ContextSectionAssemblyError'
  }
}

export type ContextSectionContribution = {
  id: string
  // Where this section sits in the assembled block, declared by the section rather than ranked by
  // core, and load-bearing for existing prompts (docs/agent-tools.md § Context sections).
  order: number
  label: string
  defaultIncluded: boolean
  budget: ContextBudget
  maxBytes?: number
  maxTokens?: number
  assemble: (args: AssembleArgs) => Promise<ContextDraft>
  format: (items: ContextItem[], omitted: number, absent?: ContextSectionResult['absent']) => string
  jump?: (item: ContextItem) => ContextItem['jump']
}

export type PluginContextSection = Omit<ContextSectionContribution, 'assemble'> & {
  assemble: (args: Omit<AssembleArgs, 'db'>) => Promise<ContextDraft>
}

// Trim a string to a byte ceiling without splitting a multi-byte character, appending an ellipsis.
// Exported because a plugin's own `format` needs the same ceiling arithmetic core applies to items.
export const truncateBytes = (value: string, max: number): string => {
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

export const formatOmitted = (omitted: number) => (omitted ? `\n- … ${omitted} more omitted` : '')

// Invariant: a section's `compact` must be computed independently of which other sections are
// included (docs/agent-tools.md § Context sections).

// ─── The one section core owns ──────────────────────────────────────────────────────────────────
//
// Every other section is registered by the plugin that owns its rows: `pr` by github, `notes` by
// notes, `memory` by memory (docs/agent-tools.md § Context sections).

// `task_links` and `issues` are core tables (docs/data-layer.md § External-item read model);
// GitHub and Rollbar write them through the ExternalItemStore seam. This is also the only section
// that reads `db`, which is why PluginContextSection can withhold the handle at no cost.
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

  // The wire order of the assembled block (docs/agent-tools.md § Context sections), so list() sorts
  // on each section's declared order rather than registration order. Ties keep registration order
  // because Array.sort is stable; two sections claiming the same slot is a contribution the author
  // should fix, not something for this list to arbitrate.
  list(): readonly ContextSectionContribution[] {
    return this.#registrations.map((r) => r.section).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }
}


const registry = new ContextSectionRegistry()

// Widen a plugin's `db`-less section to the registry's shape by dropping the handle. One helper rather
// than an inline lambda at the plugin host, so the place the handle is withheld is a named thing a reader
// can find, and so a test registering a plugin-shaped section goes through the same path production does.
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
  const project = await db.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).limit(1).then((rows) => rows[0] ?? null)
  if (!project) return null
  const projectId = project.id
  const github = project.githubOwner && project.githubName ? { owner: project.githubOwner, name: project.githubName } : null
  const repo = github ? `${github.owner}/${github.name}` : ''
  const ctx: TaskContext = {
    task: { id: task.id, title: task.title, projectId, repo: repo || undefined, branch: task.branch, worktreePath: task.worktreePath, pullNumber: task.pullNumber },
    sections: [],
    issues: [],
    notes: [],
    memory: [],
  }
  // Budget shaping and PII stripping, as somebody else's plugin (server/pluginHost/hooks.ts,
  // docs/plugins.md § Hooks). What is offered is which sections are in, as names: a handler can drop
  // one, and nothing else. Core's, not the context plugin's — the context plugin is client-only, and
  // the assembler that makes a snapshot lives here.
  //
  // The transform is intersected rather than believed, so a handler can narrow the set and cannot widen
  // it into a section the caller did not ask for.
  const shaped = await runHook('core:before-snapshot', { taskId, sections: [...include].sort() })
  if (!shaped.ok) return null
  const included = new Set(shaped.payload.sections.filter((id) => include.has(id)))
  let remainingBytes = MAX_AGENT_CONTEXT_BYTES
  let remainingTokens = Math.ceil(MAX_AGENT_CONTEXT_BYTES / 4)
  for (const contribution of registry.list()) {
    if (!included.has(contribution.id)) continue
    let draft: ContextDraft
    try {
      draft = await contribution.assemble({ db, userLogin, task, repo, github, workflowRunId: opts.workflowRunId })
    } catch (error) {
      draft = {
        items: [],
        absent: {
          reason: error instanceof ContextSectionAssemblyError
            ? error.reason
            : error instanceof DOMException && error.name === 'TimeoutError' ? 'timeout' : 'unavailable',
          detail: error instanceof Error ? error.message : 'This context section is unavailable.',
        },
      }
    }
    const budgeted = applyBudget(draft.items, contribution.budget)
    const omitted = budgeted.omitted + (draft.omitted ?? 0)
    const compatibility = budgetCompatibilityProjection(draft.compatibility, contribution.budget)
    if (compatibility) Object.assign(ctx, compatibility)
    const items = budgeted.items.map((item) => ({ ...item, jump: contribution.jump?.(item) }))
    const rawCompact = draft.compact ?? contribution.format(items, omitted, draft.absent)
    const sectionBytes = Math.min(contribution.maxBytes ?? remainingBytes, remainingBytes)
    const sectionTokens = Math.min(contribution.maxTokens ?? remainingTokens, remainingTokens)
    const compact = truncateBytes(rawCompact, Math.max(0, Math.min(sectionBytes, sectionTokens * 4)))
    const compactBytes = Buffer.byteLength(compact, 'utf8')
    const compactTokens = Math.ceil(compactBytes / 4)
    remainingBytes = Math.max(0, remainingBytes - compactBytes)
    remainingTokens = Math.max(0, remainingTokens - compactTokens)
    ctx.sections.push({
      id: contribution.id,
      label: contribution.label,
      defaultIncluded: contribution.defaultIncluded,
      budget: contribution.budget,
      items,
      compact,
      omitted,
      absent: draft.absent,
    })
  }
  return ctx
}
