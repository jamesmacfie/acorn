import { createHash } from 'node:crypto'
import { z } from 'zod'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import { IdSchema } from '../../../core/shared/publicApi/primitives'
import { CreateNoteSchema, NoteSchema, NoteSummarySchema, SetIncludedSchema, WriteNoteSchema } from '../../../core/shared/publicApi/notes'
import { NO_CONTENT, defineEndpoint, type AnyEndpoint, type PluginApiContribution } from '../../../core/server/publicApi/defineEndpoint'
import type { NoteKind, NoteLocation } from '../../../core/shared/notes'
import type { NotesStore } from '../main/notes'

// Notes plugin public API (docs/public-api.md). One collection per scope
// (global / workspace / task). `version` is sha256(body) for optimistic writes. The NotesStore is
// injected by the composition root, so this adapter has no filesystem knowledge of its own.

const PLUGIN = 'notes'
const KINDS: readonly NoteKind[] = ['scratch', 'plan', 'finding', 'handoff']

function version(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 32)
}

type Scope = {
  base: string
  extraParams: z.ZodTypeAny | null
  location(params: Record<string, string>): NoteLocation
}

const SCOPES: Scope[] = [
  { base: '/global/notes', extraParams: null, location: () => ({ scope: 'global' }) },
  {
    base: '/workspaces/:workspaceId/notes',
    extraParams: z.strictObject({ workspaceId: IdSchema }),
    location: (p) => ({ scope: 'workspace', workspaceId: p.workspaceId }),
  },
  {
    base: '/tasks/:taskId/notes',
    extraParams: z.strictObject({ taskId: IdSchema }),
    location: (p) => ({ scope: 'task', taskId: p.taskId }),
  },
]

const SlugParam = z.strictObject({ slug: z.string().min(1).max(120) })

export function buildNotesPublicApi(store: NotesStore): PluginApiContribution {
  // Read one note into the public shape, computing its version. not_found on a missing note.
  const readNote = async (loc: NoteLocation, slug: string) => {
    try {
      const note = await store.read(loc, slug)
      const list = await store.list(loc)
      // mtimeMs is fractional; UnixMillis is an integer.
      const updatedAt = Math.floor(list.find((n) => n.slug === slug)?.updatedAt ?? 0)
      return { slug: note.slug, title: note.title, kind: note.kind, included: note.included, updatedAt, body: note.body, version: version(note.body) }
    } catch {
      throw new PublicApiError('not_found', 'Note not found')
    }
  }
  const summaryOf = (n: Awaited<ReturnType<typeof readNote>>) => ({ slug: n.slug, title: n.title, kind: n.kind, included: n.included, updatedAt: n.updatedAt, version: n.version })

  const endpoints: AnyEndpoint[] = []
  for (const scope of SCOPES) {
    const listParams = scope.extraParams
    const itemParams = scope.extraParams ? (scope.extraParams as z.ZodObject).extend(SlugParam.shape) : SlugParam
    const opId = (verb: string) => `notes.${scope.base.includes(':workspaceId') ? 'workspace' : scope.base.includes(':taskId') ? 'task' : 'global'}.${verb}`

    endpoints.push(
      defineEndpoint({
        operationId: opId('list'),
        pluginId: PLUGIN,
        method: 'GET',
        path: scope.base,
        scope: 'read',
        risk: 'read',
        summary: 'List notes',
        ...(listParams ? { params: listParams } : {}),
        response: z.strictObject({ items: z.array(NoteSummarySchema) }),
        handler: async (_ctx, { params }) => {
          const loc = scope.location((params ?? {}) as Record<string, string>)
          const summaries = await Promise.all((await store.list(loc)).map((n) => readNote(loc, n.slug).then(summaryOf)))
          return { items: summaries }
        },
      }),
      defineEndpoint({
        operationId: opId('create'),
        pluginId: PLUGIN,
        method: 'POST',
        path: scope.base,
        scope: 'write',
        risk: 'write',
        summary: 'Create a note',
        idempotency: 'required',
        ...(listParams ? { params: listParams } : {}),
        body: CreateNoteSchema,
        response: NoteSummarySchema,
        status: 201,
        handler: async (_ctx, { params, body }) => {
          const loc = scope.location((params ?? {}) as Record<string, string>)
          const kind = body.kind && (KINDS as readonly string[]).includes(body.kind) ? (body.kind as NoteKind) : undefined
          const { slug } = await store.create(loc, body.title, { kind })
          return summaryOf(await readNote(loc, slug))
        },
      }),
      defineEndpoint({
        operationId: opId('get'),
        pluginId: PLUGIN,
        method: 'GET',
        path: `${scope.base}/:slug`,
        scope: 'read',
        risk: 'read',
        summary: 'Get a note',
        params: itemParams,
        response: NoteSchema,
        handler: async (_ctx, { params }) => {
          const p = params as Record<string, string>
          return readNote(scope.location(p), p.slug)
        },
      }),
      defineEndpoint({
        operationId: opId('write'),
        pluginId: PLUGIN,
        method: 'PUT',
        path: `${scope.base}/:slug`,
        scope: 'write',
        risk: 'write',
        summary: 'Replace a note body (optimistic)',
        params: itemParams,
        body: WriteNoteSchema,
        response: NoteSchema,
        handler: async (_ctx, { params, body }) => {
          const p = params as Record<string, string>
          const loc = scope.location(p)
          const current = await readNote(loc, p.slug)
          if (body.expectedVersion !== undefined && body.expectedVersion !== current.version) {
            throw new PublicApiError('file_changed', 'The note changed since it was read')
          }
          await store.write(loc, p.slug, body.body)
          return readNote(loc, p.slug)
        },
      }),
      defineEndpoint({
        operationId: opId('delete'),
        pluginId: PLUGIN,
        method: 'DELETE',
        path: `${scope.base}/:slug`,
        scope: 'write',
        risk: 'write',
        summary: 'Delete a note',
        params: itemParams,
        response: z.undefined(),
        status: 204,
        handler: async (_ctx, { params }) => {
          const p = params as Record<string, string>
          await store.remove(scope.location(p), p.slug)
          return NO_CONTENT
        },
      }),
      defineEndpoint({
        operationId: opId('included'),
        pluginId: PLUGIN,
        method: 'PUT',
        path: `${scope.base}/:slug/included`,
        scope: 'write',
        risk: 'write',
        summary: 'Set whether a note is included as agent context',
        params: itemParams,
        body: SetIncludedSchema,
        response: NoteSummarySchema,
        handler: async (_ctx, { params, body }) => {
          const p = params as Record<string, string>
          const loc = scope.location(p)
          await store.setIncluded(loc, p.slug, body.included)
          return summaryOf(await readNote(loc, p.slug))
        },
      }),
    )
  }

  return { pluginId: PLUGIN, endpoints }
}
