import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { and, eq, isNotNull, isNull, lt, or } from 'drizzle-orm'
import type { AppDatabase } from '@acorn/node-core/server/db/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import type { AgentAttachment } from '@acorn/protocol/managedAgents.ts'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TEXT_BYTES = 1024 * 1024
const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1_000

const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'json', 'jsonl', 'yaml', 'yml', 'toml', 'xml', 'csv',
  'ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs', 'css', 'html', 'htm',
  'py', 'rb', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'hpp', 'swift', 'kt', 'kts',
  'sh', 'bash', 'zsh', 'fish', 'sql', 'graphql', 'gql', 'diff', 'patch', 'log',
])

const rowToAttachment = (row: typeof schema.agentAttachments.$inferSelect): AgentAttachment => ({
  id: row.id,
  taskId: row.taskId,
  filename: row.filename,
  mediaType: row.mediaType,
  byteSize: row.byteSize,
  createdAt: row.createdAt,
})

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((value, index) => bytes[index] === value)

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  new TextDecoder().decode(bytes.slice(start, end))

function validatedMediaType(filename: string, supplied: string, bytes: Uint8Array): {
  mediaType: string
  textEncoding: string | null
} {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mediaType: 'image/png', textEncoding: null }
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mediaType: 'image/jpeg', textEncoding: null }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { mediaType: 'image/gif', textEncoding: null }
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { mediaType: 'image/webp', textEncoding: null }
  }
  if (ascii(bytes, 0, 5) === '%PDF-') return { mediaType: 'application/pdf', textEncoding: null }

  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  const declaredText = supplied.startsWith('text/')
    || ['application/json', 'application/xml', 'application/yaml'].includes(supplied)
    || TEXT_EXTENSIONS.has(extension)
  if (!declaredText) throw new Error('Unsupported attachment type. Use JPEG, PNG, GIF, WebP, PDF, or UTF-8 text/source files.')
  if (bytes.byteLength > MAX_TEXT_BYTES) throw new Error('Decoded text attachments are limited to 1 MiB.')
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('Text attachments must contain valid UTF-8.')
  }
  return { mediaType: supplied.startsWith('text/') ? supplied : 'text/plain', textEncoding: 'utf-8' }
}

export class AgentAttachmentStore {
  readonly root: string

  constructor(
    private readonly db: AppDatabase,
    dataDir: string,
  ) {
    this.root = join(dataDir, 'agent-objects')
  }

  async upload(taskId: string, filename: string, suppliedMediaType: string, bytes: Uint8Array): Promise<AgentAttachment> {
    if (!bytes.byteLength) throw new Error('Empty attachments are not supported.')
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error('Attachments are limited to 10 MiB each.')
    const [task] = await this.db.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1)
    if (!task) throw new Error('Task not found.')
    const safeFilename = basename(filename).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 500) || 'attachment'
    const validated = validatedMediaType(safeFilename, suppliedMediaType.toLowerCase(), bytes)
    const hash = createHash('sha256').update(bytes).digest('hex')
    const [existing] = await this.db
      .select()
      .from(schema.agentAttachments)
      .where(and(
        eq(schema.agentAttachments.taskId, taskId),
        eq(schema.agentAttachments.contentHash, hash),
      ))
      .limit(1)
    if (existing && existing.deletedAt == null) return rowToAttachment(existing)

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
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Attachment object path is not a regular file.')
      const existingHash = createHash('sha256').update(await readFile(path)).digest('hex')
      if (existingHash !== hash) throw new Error('Attachment object failed its integrity check.')
    }

    const timestamp = Date.now()
    if (existing) {
      await this.db
        .update(schema.agentAttachments)
        .set({
          filename: safeFilename,
          mediaType: validated.mediaType,
          byteSize: bytes.byteLength,
          textEncoding: validated.textEncoding,
          deletedAt: null,
          createdAt: timestamp,
        })
        .where(eq(schema.agentAttachments.id, existing.id))
      return {
        id: existing.id,
        taskId,
        filename: safeFilename,
        mediaType: validated.mediaType,
        byteSize: bytes.byteLength,
        createdAt: timestamp,
      }
    }
    const id = randomUUID()
    await this.db.insert(schema.agentAttachments).values({
      id,
      taskId,
      storageKey,
      contentHash: hash,
      filename: safeFilename,
      mediaType: validated.mediaType,
      byteSize: bytes.byteLength,
      textEncoding: validated.textEncoding,
      createdAt: timestamp,
    }).onConflictDoNothing()
    const [row] = await this.db
      .select()
      .from(schema.agentAttachments)
      .where(and(eq(schema.agentAttachments.taskId, taskId), eq(schema.agentAttachments.contentHash, hash)))
      .limit(1)
    if (!row) throw new Error('Attachment metadata was not persisted.')
    return rowToAttachment(row)
  }

  async get(id: string): Promise<AgentAttachment | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentAttachments)
      .where(and(eq(schema.agentAttachments.id, id), isNull(schema.agentAttachments.deletedAt)))
      .limit(1)
    return row ? rowToAttachment(row) : null
  }

  async resolve(id: string): Promise<(AgentAttachment & { localPath: string }) | null> {
    const [row] = await this.db
      .select()
      .from(schema.agentAttachments)
      .where(and(eq(schema.agentAttachments.id, id), isNull(schema.agentAttachments.deletedAt)))
      .limit(1)
    if (!row) return null
    return { ...rowToAttachment(row), localPath: join(this.root, row.storageKey) }
  }

  async removeUnreferenced(id: string): Promise<boolean> {
    const [reference] = await this.db
      .select({ attachmentId: schema.agentAttachmentRefs.attachmentId })
      .from(schema.agentAttachmentRefs)
      .where(eq(schema.agentAttachmentRefs.attachmentId, id))
      .limit(1)
    if (reference) return false
    await this.db.update(schema.agentAttachments).set({ deletedAt: Date.now() }).where(eq(schema.agentAttachments.id, id))
    return true
  }

  async collectGarbage(): Promise<number> {
    const cutoff = Date.now() - UPLOAD_GRACE_MS
    const rows = await this.db
      .select()
      .from(schema.agentAttachments)
      .where(or(
        and(isNull(schema.agentAttachments.deletedAt), lt(schema.agentAttachments.createdAt, cutoff)),
        and(isNotNull(schema.agentAttachments.deletedAt), lt(schema.agentAttachments.deletedAt, cutoff)),
      ))
    let removed = 0
    for (const row of rows) {
      if (!await this.removeUnreferenced(row.id)) continue
      await this.#unlinkIfUnused(row.storageKey)
      removed++
    }
    return removed
  }

  async collectNow(ids: string[]): Promise<void> {
    for (const id of new Set(ids)) {
      const [row] = await this.db.select().from(schema.agentAttachments).where(eq(schema.agentAttachments.id, id)).limit(1)
      if (!row || !await this.removeUnreferenced(id)) continue
      await this.#unlinkIfUnused(row.storageKey)
    }
  }

  async #unlinkIfUnused(storageKey: string): Promise<void> {
    const otherLive = await this.db
      .select({ id: schema.agentAttachments.id })
      .from(schema.agentAttachments)
      .where(and(eq(schema.agentAttachments.storageKey, storageKey), isNull(schema.agentAttachments.deletedAt)))
      .limit(1)
    if (!otherLive.length) await unlink(join(this.root, storageKey)).catch(() => undefined)
  }
}
