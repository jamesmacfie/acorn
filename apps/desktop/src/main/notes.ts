// Workspace notes store (docs/next 09 P1): plain .md files with YAML-ish frontmatter at
// <dataDir>/notes/<workspaceId>/<slug>.md — ONE store (main process) read by the UI and, later,
// the MCP notes_* tools. Files are gitignored working state (Conductor's .context-in-git bug is
// the warning); durable knowledge is promoted into committed memory (12). Kinds are
// scratch|plan|finding|handoff ONLY — anchored annotations are review_notes rows (README
// decision 16), never note kinds. Writes are atomic (temp+rename); slugs are validated at this
// boundary. Human-editable by hand — the frontmatter is plain key: value lines.
import { mkdirSync } from 'node:fs'
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Note, NoteAuthor, NoteKind, NoteSummary } from '../shared/notes'

// Canonical wire shapes live in shared/notes.ts (imported by the client too); re-exported here so
// main-side callers keep one import point.
export type { Note, NoteAuthor, NoteKind, NoteSummary } from '../shared/notes'

// The frontmatter block of a note file — Note minus slug/body.
export type NoteMeta = Omit<Note, 'slug' | 'body'>

// Safe filename component: no traversal, no separators, no dotfiles.
export const isValidSlug = (s: string): boolean => /^[a-z0-9][a-z0-9._-]*$/i.test(s) && !s.includes('..')
// Workspace ids are opaque uuids; hold them to the same charset before they touch a path.
const isValidDirKey = (s: string): boolean => /^[A-Za-z0-9_-]+$/.test(s)

export const slugifyTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 60) || 'note'

const AUTHORS: readonly NoteAuthor[] = ['user', 'agent', 'workflow']
const KINDS: readonly NoteKind[] = ['scratch', 'plan', 'finding', 'handoff']

// --- Pure frontmatter round-trip (minimal key: value block, not full YAML — ponytail) ---

export function serializeNote(meta: NoteMeta, body: string): string {
  const lines = [
    '---',
    `title: ${meta.title}`,
    `author: ${meta.author}`,
    `kind: ${meta.kind}`,
    ...(meta.originSessionId ? [`originSessionId: ${meta.originSessionId}`] : []),
    `createdAt: ${meta.createdAt}`,
    '---',
    '',
  ]
  return lines.join('\n') + body
}

export function parseNote(text: string, slug: string): { meta: NoteMeta; body: string } {
  let body = text
  const fields: Record<string, string> = {}
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4)
    if (end > 0) {
      for (const line of text.slice(4, end).split('\n')) {
        const i = line.indexOf(':')
        if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
      }
      body = text.slice(end + 4).replace(/^\n/, '')
    }
  }
  // Title: frontmatter → first `#` heading → slug (verne's derivation order).
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
  const meta: NoteMeta = {
    title: fields.title || heading || slug,
    author: AUTHORS.includes(fields.author as NoteAuthor) ? (fields.author as NoteAuthor) : 'user',
    kind: KINDS.includes(fields.kind as NoteKind) ? (fields.kind as NoteKind) : 'scratch',
    originSessionId: fields.originSessionId || null,
    createdAt: Number(fields.createdAt) || 0,
  }
  return { meta, body }
}

// --- The store ---

export class NotesStore {
  constructor(private root: string) {}

  private dirFor(workspaceId: string): string {
    if (!isValidDirKey(workspaceId)) throw new Error('Invalid workspace id.')
    const dir = join(this.root, workspaceId)
    mkdirSync(dir, { recursive: true })
    return dir
  }

  private fileFor(workspaceId: string, slug: string): string {
    if (!isValidSlug(slug)) throw new Error('Invalid note slug.')
    return join(this.dirFor(workspaceId), `${slug}.md`)
  }

  // Atomic write: temp + rename, so a crash never leaves a partial note.
  private async atomicWrite(file: string, text: string): Promise<void> {
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, text, 'utf8')
    try {
      await rename(tmp, file)
    } catch (e) {
      await unlink(tmp).catch(() => {})
      throw e
    }
  }

  async list(workspaceId: string): Promise<NoteSummary[]> {
    const dir = this.dirFor(workspaceId)
    const entries = await readdir(dir).catch(() => [] as string[])
    const out: NoteSummary[] = []
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      const slug = name.slice(0, -3)
      if (!isValidSlug(slug)) continue
      try {
        const file = join(dir, name)
        const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
        const { meta } = parseNote(text, slug)
        out.push({ slug, title: meta.title, author: meta.author, kind: meta.kind, updatedAt: st.mtimeMs })
      } catch {
        // unreadable note → skipped, never breaks the list
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async read(workspaceId: string, slug: string): Promise<Note> {
    const text = await readFile(this.fileFor(workspaceId, slug), 'utf8')
    const { meta, body } = parseNote(text, slug)
    return { slug, body, ...meta }
  }

  async create(workspaceId: string, title: string, opts?: { author?: NoteAuthor; kind?: NoteKind; originSessionId?: string; body?: string }): Promise<{ slug: string }> {
    const base = slugifyTitle(title)
    const existing = new Set((await this.list(workspaceId)).map((n) => n.slug))
    let slug = base
    for (let i = 2; existing.has(slug); i++) slug = `${base}-${i}`
    const meta: NoteMeta = {
      title: title.trim() || slug,
      author: opts?.author ?? 'user',
      kind: opts?.kind ?? 'scratch',
      originSessionId: opts?.originSessionId ?? null,
      createdAt: Date.now(),
    }
    await this.atomicWrite(this.fileFor(workspaceId, slug), serializeNote(meta, opts?.body ?? ''))
    return { slug }
  }

  // Replace the body, preserving frontmatter (an edit never changes provenance).
  async write(workspaceId: string, slug: string, body: string): Promise<void> {
    const file = this.fileFor(workspaceId, slug)
    const { meta } = parseNote(await readFile(file, 'utf8').catch(() => ''), slug)
    if (!meta.createdAt) meta.createdAt = Date.now()
    await this.atomicWrite(file, serializeNote(meta, body))
  }

  // Append (agents logging findings). Missing note → created with the writer's identity.
  async append(workspaceId: string, slug: string, text: string, opts?: { author?: NoteAuthor; originSessionId?: string }): Promise<void> {
    const file = this.fileFor(workspaceId, slug)
    const existing = await readFile(file, 'utf8').catch(() => null)
    if (existing == null) {
      const meta: NoteMeta = {
        title: slug,
        author: opts?.author ?? 'user',
        kind: 'finding',
        originSessionId: opts?.originSessionId ?? null,
        createdAt: Date.now(),
      }
      await this.atomicWrite(file, serializeNote(meta, text.endsWith('\n') ? text : `${text}\n`))
      return
    }
    const sep = existing.endsWith('\n') ? '' : '\n'
    await this.atomicWrite(file, `${existing}${sep}${text.endsWith('\n') ? text : `${text}\n`}`)
  }

  async remove(workspaceId: string, slug: string): Promise<void> {
    await unlink(this.fileFor(workspaceId, slug)).catch(() => {})
  }
}
