// Memory auto-generation (docs/next 12 P3): the harness dividend — acorn owns the task boundary,
// so extraction fires deterministically at task completion (agent session end / archive), runs a
// HEADLESS memory-review step (fake agent in tests), passes a cheap verify (referenced files
// exist, duplicate content-hash, contradiction flag), and files PROPOSALS through the human gate
// (12's counter to LLM-rewrite corruption). Nothing touches disk as memory until a human accepts;
// accepted memories land in the TASK WORKTREE (reviewed via its PR) + the index updates.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { AppDatabase } from '../server/db'
import type { HeadlessResult } from './headless'
import { contentHashId, MEMORY_TYPES, writeMemoryFile, type MemoryType } from './memory'
import type { MemoryProposal, MemoryProposalStore } from './memoryProposals'

export type MemoryCandidate = {
  name: string
  type: MemoryType
  description: string
  body: string
  refs?: string[] // repo-relative files the memory cites
}

export const MEMORY_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    memories: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { enum: [...MEMORY_TYPES] },
          description: { type: 'string' },
          body: { type: 'string' },
          refs: { type: 'array', items: { type: 'string' } },
        },
        required: ['name', 'type', 'description', 'body'],
      },
    },
  },
  required: ['memories'],
} as const

export type VerifyContext = {
  fileExists: (repoRelPath: string) => boolean
  existingIds: Set<string> // content-hash ids already indexed
  existingByName: Map<string, { description: string; body: string }>
}

export type VerifiedCandidate = { candidate: MemoryCandidate; blocking: string[]; flags: string[] }

// The 3 checks acorn needs (Cloudflare runs 8): dangling refs + duplicates BLOCK; a same-name
// different-content memory is a contradiction FLAG the human resolves at the gate (supersede,
// never overwrite in place).
export function verifyCandidates(candidates: MemoryCandidate[], ctx: VerifyContext): VerifiedCandidate[] {
  return candidates.map((candidate) => {
    const blocking: string[] = []
    const flags: string[] = []
    for (const ref of candidate.refs ?? []) {
      if (!ctx.fileExists(ref)) blocking.push(`references a missing file: ${ref}`)
    }
    if (ctx.existingIds.has(contentHashId(candidate.name, candidate.body, candidate.description))) blocking.push('duplicate of an existing memory (content hash)')
    const existing = ctx.existingByName.get(candidate.name)
    if (existing && (existing.body !== candidate.body || existing.description !== candidate.description))
      flags.push(`contradicts the existing '${candidate.name}' — accepting supersedes it`)
    return { candidate, blocking, flags }
  })
}

const parseCandidates = (structured: unknown): MemoryCandidate[] => {
  const list = (structured as { memories?: unknown[] })?.memories
  if (!Array.isArray(list)) return []
  return list.filter(
    (m): m is MemoryCandidate =>
      !!m &&
      typeof m === 'object' &&
      typeof (m as MemoryCandidate).name === 'string' &&
      MEMORY_TYPES.includes((m as MemoryCandidate).type) &&
      typeof (m as MemoryCandidate).description === 'string' &&
      typeof (m as MemoryCandidate).body === 'string',
  )
}

export type MemoryGenDeps = {
  runReview(prompt: string, schema: object): Promise<HeadlessResult>
  taskDiff(): Promise<string>
  transcriptTail(): Promise<string>
  existingIndex(): Promise<{ id: string; name: string; description: string; body: string }[]>
  fileExists(repoRelPath: string): boolean
  propose(candidate: MemoryCandidate, flags: string[]): Promise<void>
}

export type MemoryGenOutcome = { proposed: number; rejected: { name: string; issues: string[] }[]; error?: string }

export async function generateMemoryProposals(deps: MemoryGenDeps): Promise<MemoryGenOutcome> {
  const [diff, transcript, existing] = await Promise.all([deps.taskDiff(), deps.transcriptTail(), deps.existingIndex()])
  if (!diff.trim() && !transcript.trim()) return { proposed: 0, rejected: [] } // nothing happened → nothing to distil
  const index = existing.map((m) => `- ${m.name} — ${m.description}`).join('\n')
  const prompt = [
    'You are the memory-review pass for a finished task. Distil DURABLE, cross-task knowledge',
    '(conventions, architecture, decisions with a Why:, fixes/gotchas, references) from the work',
    'below. Skip ephemeral task detail. Each memory: kebab-case name, one-line description, a body',
    'with a **Why:** line, and refs listing repo files it cites.',
    '',
    '## Existing memory index (do not duplicate)',
    index || '(none)',
    '',
    '## Task diff',
    diff.slice(0, 20_000) || '(no diff)',
    '',
    '## Session transcript tail',
    transcript.slice(0, 10_000) || '(none)',
  ].join('\n')

  const review = await deps.runReview(prompt, MEMORY_REVIEW_SCHEMA)
  if (review.status !== 'ok') return { proposed: 0, rejected: [], error: `memory review ${review.status}` }
  const candidates = parseCandidates(review.capture.structuredOutput)
  const verified = verifyCandidates(candidates, {
    fileExists: deps.fileExists,
    existingIds: new Set(existing.map((m) => m.id)),
    existingByName: new Map(existing.map((m) => [m.name, { description: m.description, body: m.body }])),
  })
  const rejected: { name: string; issues: string[] }[] = []
  let proposed = 0
  for (const v of verified) {
    if (v.blocking.length) {
      rejected.push({ name: v.candidate.name, issues: v.blocking })
      continue
    }
    await deps.propose(v.candidate, v.flags)
    proposed += 1
  }
  return { proposed, rejected }
}

// --- The gate's verdict paths (the ONLY way memory lands on disk from this pipeline) ---

export async function acceptProposal(
  store: MemoryProposalStore,
  id: string,
  worktreePath: string | null,
  reconcile: () => Promise<void>,
  edited?: { name: string; type: MemoryType; description: string; body: string },
): Promise<{ ok: boolean; reason?: string }> {
  const proposal = await store.get(id)
  if (!proposal || proposal.status !== 'pending') return { ok: false, reason: 'Proposal not found or already resolved.' }
  if (!worktreePath || !existsSync(worktreePath)) return { ok: false, reason: 'The task worktree is gone — repo-scoped memory has nowhere to land.' }
  const final = { ...proposal, ...(edited ?? {}) }
  await writeMemoryFile(join(worktreePath, '.acorn', 'memory'), {
    name: final.name,
    description: final.description,
    type: final.type,
    originSessionId: proposal.originSessionId,
    commitSha: null,
    supersededBy: null,
    createdAt: Date.now(),
    body: final.body,
  })
  await store.resolve(id, 'accepted', edited)
  await reconcile()
  return { ok: true }
}

export async function rejectProposal(store: MemoryProposalStore, id: string): Promise<{ ok: boolean }> {
  await store.resolve(id, 'rejected')
  return { ok: true }
}

export type { MemoryProposal }
