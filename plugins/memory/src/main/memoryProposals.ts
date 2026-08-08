// Memory proposals (docs/notes-and-memory.md, docs/mcp.md): agent memory_write NEVER lands silently — it files a
// proposal here, and the human gate (accept/edit/reject, 6.6) is the only path that writes a
// memory .md. Proposals are JSON files under <dataDir>/memory-proposals/ — visible, greppable,
// crash-safe, no schema.
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { isValidMemoryName, MEMORY_TYPES, type MemoryType } from './memory'

export type MemoryProposal = {
  id: string
  taskId: string
  projectId: string | null
  name: string
  type: MemoryType
  description: string
  body: string
  // Verification FLAGS from the auto-generation pass (memoryGen verifyCandidates) — e.g. a
  // contradiction with an existing memory. Carried structurally (never folded into description,
  // which would leak into the memory file on accept) so the gate UI can render them separately.
  flags: string[]
  originSessionId: string | null
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: number
}

const memoryProposalSchema = z
  .object({
    id: z.string().min(1),
    taskId: z.string().min(1),
    projectId: z.string().nullable().optional(),
    // Pre-Phase-4 proposals used a repo pair string. It remains readable but is deliberately
    // discarded instead of being guessed into a project id.
    repo: z.string().nullable().optional(),
    name: z.string(),
    type: z.enum(MEMORY_TYPES),
    description: z.string(),
    body: z.string(),
    flags: z.array(z.string()).default([]),
    originSessionId: z.string().nullable(),
    status: z.enum(['pending', 'accepted', 'rejected']),
    createdAt: z.number(),
  })
  .transform(({ repo: _repo, projectId, ...proposal }) => ({ ...proposal, projectId: projectId ?? null }))

export class MemoryProposalStore {
  constructor(private root: string) {
    mkdirSync(root, { recursive: true })
  }

  private fileFor(id: string): string {
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid proposal id.')
    return join(this.root, `${id}.json`)
  }

  private async atomicWrite(file: string, value: MemoryProposal): Promise<void> {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    try {
      await rename(tmp, file)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
  }

  async propose(input: Omit<MemoryProposal, 'id' | 'status' | 'createdAt' | 'flags'> & { flags?: string[] }): Promise<MemoryProposal> {
    if (!input.name || !isValidMemoryName(input.name)) throw new Error('Invalid memory name.')
    if (!MEMORY_TYPES.includes(input.type)) throw new Error('Invalid memory type.')
    if (!input.description.trim()) throw new Error('Description required.')
    const proposal: MemoryProposal = { ...input, flags: input.flags ?? [], id: randomUUID(), status: 'pending', createdAt: Date.now() }
    await this.atomicWrite(this.fileFor(proposal.id), proposal)
    return proposal
  }

  async list(status?: MemoryProposal['status']): Promise<MemoryProposal[]> {
    const entries = await readdir(this.root).catch(() => [] as string[])
    const out: MemoryProposal[] = []
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      try {
        const parsed = memoryProposalSchema.safeParse(JSON.parse(await readFile(join(this.root, name), 'utf8')))
        if (!parsed.success) continue
        const p: MemoryProposal = parsed.data
        if (!status || p.status === status) out.push(p)
      } catch {
        // unreadable proposal → skipped
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  async get(id: string): Promise<MemoryProposal | null> {
    try {
      const parsed = memoryProposalSchema.safeParse(JSON.parse(await readFile(this.fileFor(id), 'utf8')))
      return parsed.success ? parsed.data : null
    } catch {
      return null
    }
  }

  // The gate's verdict (6.6 calls this after accept-writes-the-file or on reject).
  async resolve(id: string, status: 'accepted' | 'rejected', edited?: Pick<MemoryProposal, 'name' | 'description' | 'body' | 'type'>): Promise<MemoryProposal | null> {
    const p = await this.get(id)
    if (!p) return null
    const next: MemoryProposal = { ...p, ...edited, status }
    await this.atomicWrite(this.fileFor(id), next)
    return next
  }
}
