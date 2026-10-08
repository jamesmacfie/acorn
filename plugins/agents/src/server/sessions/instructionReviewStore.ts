import { createHash, randomUUID } from 'node:crypto'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { PluginDatabase, SecretService } from '@acorn/plugin-api/node'
import * as schema from '../../node/schema'
import type { InstructionSnapshot } from './instructionSnapshot'

type StoredFile = { path: string; canonicalPath: string; sha256: string; bytes: number; kind: string; unsupported: boolean }
export type ReviewMetadata = { id: string; projectId: string; digest: string; files: StoredFile[]; scope: string; analyzerVersion: number; approvedAt: number | null }

export function snapshotDigest(snapshot: InstructionSnapshot): string {
  const files = snapshot.files.map(({ path, canonicalPath, sha256, bytes, kind }) => ({ path, canonicalPath, sha256, bytes, kind }))
  return createHash('sha256').update(JSON.stringify({ version: snapshot.version, scope: snapshot.scope, files })).digest('hex')
}

export class InstructionReviewStore {
  constructor(private readonly db: PluginDatabase, private readonly secrets: SecretService) {}

  async save(projectId: string, snapshot: InstructionSnapshot, signal?: AbortSignal): Promise<ReviewMetadata> {
    if (signal?.aborted) throw new Error('Instruction review cancelled before storage.')
    const body = JSON.stringify(snapshot.files.map(({ path, text }) => ({ path, text })))
    if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new Error('Instruction snapshot exceeds 8 MiB.')
    const files = snapshot.files.map(({ text: _text, ...file }) => file)
    const id = randomUUID()
    const now = Date.now()
    const bodyEnc = await this.secrets.seal(body)
    if (signal?.aborted) throw new Error('Instruction review cancelled before storage.')
    this.db.transaction((tx) => {
      tx.insert(schema.agentInstructionSnapshots).values({
        id, projectId, digest: snapshotDigest(snapshot), scope: snapshot.scope,
        analyzerVersion: snapshot.version, filesJson: JSON.stringify(files),
        bodyEnc, createdAt: now, approvedAt: null,
      }).run()
      // Keep the latest pending review and the latest approved snapshot.
      const rows = tx.select().from(schema.agentInstructionSnapshots)
        .where(eq(schema.agentInstructionSnapshots.projectId, projectId))
        .orderBy(desc(schema.agentInstructionSnapshots.createdAt)).all()
      const keep = new Set<string>([id])
      const approved = rows.find((row) => row.approvedAt !== null)
      if (approved) keep.add(approved.id)
      for (const row of rows) if (!keep.has(row.id)) {
        tx.delete(schema.agentInstructionSnapshots).where(eq(schema.agentInstructionSnapshots.id, row.id)).run()
      }
    })
    return { id, projectId, digest: snapshotDigest(snapshot), files, scope: snapshot.scope, analyzerVersion: snapshot.version, approvedAt: null }
  }

  async get(id: string): Promise<{ metadata: ReviewMetadata; bodies: Array<{ path: string; text: string | null }> } | null> {
    const [row] = await this.db.select().from(schema.agentInstructionSnapshots).where(eq(schema.agentInstructionSnapshots.id, id))
    if (!row) return null
    const metadata = this.metadata(row)
    const bodies = JSON.parse(await this.secrets.reveal(row.bodyEnc, 'instruction review')) as Array<{ path: string; text: string | null }>
    return { metadata, bodies }
  }

  async approved(projectId: string, digest?: string): Promise<ReviewMetadata | null> {
    const rows = await this.db.select().from(schema.agentInstructionSnapshots)
      .where(and(eq(schema.agentInstructionSnapshots.projectId, projectId), isNotNull(schema.agentInstructionSnapshots.approvedAt)))
      .orderBy(desc(schema.agentInstructionSnapshots.approvedAt)).limit(2)
    const row = digest ? rows.find((candidate) => candidate.digest === digest) : rows[0]
    if (!row) return null
    // A missing key or damaged ciphertext invalidates approval even if the metadata still matches.
    await this.secrets.reveal(row.bodyEnc, 'instruction admission')
    return this.metadata(row)
  }

  async approve(id: string, projectId: string): Promise<void> {
    this.db.transaction((tx) => {
      tx.update(schema.agentInstructionSnapshots).set({ approvedAt: Date.now() })
        .where(and(eq(schema.agentInstructionSnapshots.id, id), eq(schema.agentInstructionSnapshots.projectId, projectId))).run()
      const rows = tx.select().from(schema.agentInstructionSnapshots)
        .where(eq(schema.agentInstructionSnapshots.projectId, projectId))
        .orderBy(desc(schema.agentInstructionSnapshots.approvedAt)).all()
      for (const row of rows.slice(2)) tx.delete(schema.agentInstructionSnapshots).where(eq(schema.agentInstructionSnapshots.id, row.id)).run()
    })
  }

  async deleteProject(projectId: string): Promise<void> {
    await this.db.delete(schema.agentInstructionSnapshots).where(eq(schema.agentInstructionSnapshots.projectId, projectId))
  }

  private metadata(row: typeof schema.agentInstructionSnapshots.$inferSelect): ReviewMetadata {
    return { id: row.id, projectId: row.projectId, digest: row.digest, files: JSON.parse(row.filesJson) as StoredFile[],
      scope: row.scope, analyzerVersion: row.analyzerVersion, approvedAt: row.approvedAt }
  }

}
