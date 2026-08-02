import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { and, asc, eq, ne } from 'drizzle-orm'
import type { AppDatabase } from '../../../core/server/db'
import { schema } from '../../../core/server/db'
import type { AgentArtifact, AgentArtifactKind } from '@acorn/protocol/managedAgents.ts'

export type RemovedArtifactObject = { id: string; storageKey: string | null }

const mapArtifact = (row: typeof schema.agentArtifacts.$inferSelect): AgentArtifact => ({
  id: row.id,
  sessionId: row.sessionId,
  turnId: row.turnId,
  kind: row.kind as AgentArtifactKind,
  title: row.title,
  mediaType: row.mediaType,
  byteSize: row.byteSize,
  metadata: JSON.parse(row.metadataJson) as Record<string, unknown>,
  createdAt: row.createdAt,
})

export class AgentArtifactStore {
  readonly root: string

  constructor(
    private readonly db: AppDatabase,
    dataDir: string,
  ) {
    this.root = join(dataDir, 'agent-artifacts')
  }

  async putText(input: {
    sessionId: string
    turnId: string | null
    kind: AgentArtifactKind
    title: string
    text: string
    mediaType?: string
    metadata?: Record<string, unknown>
  }): Promise<AgentArtifact> {
    const bytes = Buffer.from(input.text, 'utf8')
    const hash = createHash('sha256').update(bytes).digest('hex')
    const storageKey = `${hash.slice(0, 2)}/${hash}`
    const directory = join(this.root, hash.slice(0, 2))
    const path = join(directory, hash)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    try {
      const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
      try {
        await handle.writeFile(bytes)
      } finally {
        await handle.close()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Artifact object path is not a regular file.')
      if (createHash('sha256').update(await readFile(path)).digest('hex') !== hash) {
        throw new Error('Artifact object failed its integrity check.')
      }
    }
    const id = randomUUID()
    await this.db.insert(schema.agentArtifacts).values({
      id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      kind: input.kind,
      title: input.title.slice(0, 500),
      mediaType: input.mediaType ?? 'text/plain; charset=utf-8',
      storageKey,
      byteSize: bytes.byteLength,
      metadataJson: JSON.stringify({ ...input.metadata, sha256: hash }),
      createdAt: Date.now(),
    })
    const artifact = await this.get(id)
    if (!artifact) throw new Error('Artifact metadata was not persisted.')
    return artifact
  }

  async list(sessionId: string): Promise<AgentArtifact[]> {
    const rows = await this.db
      .select()
      .from(schema.agentArtifacts)
      .where(eq(schema.agentArtifacts.sessionId, sessionId))
      .orderBy(asc(schema.agentArtifacts.createdAt))
    return rows.map(mapArtifact)
  }

  async get(id: string): Promise<AgentArtifact | null> {
    const [row] = await this.db.select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, id)).limit(1)
    return row ? mapArtifact(row) : null
  }

  async read(id: string): Promise<{ artifact: AgentArtifact; bytes: Uint8Array } | null> {
    const [row] = await this.db.select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, id)).limit(1)
    if (!row?.storageKey) return null
    return { artifact: mapArtifact(row), bytes: await readFile(join(this.root, row.storageKey)) }
  }

  async collectRemoved(objects: RemovedArtifactObject[]): Promise<void> {
    for (const object of objects) {
      if (!object.storageKey) continue
      const [other] = await this.db
        .select({ id: schema.agentArtifacts.id })
        .from(schema.agentArtifacts)
        .where(and(eq(schema.agentArtifacts.storageKey, object.storageKey), ne(schema.agentArtifacts.id, object.id)))
        .limit(1)
      if (!other) await unlink(join(this.root, object.storageKey)).catch(() => undefined)
    }
  }
}
