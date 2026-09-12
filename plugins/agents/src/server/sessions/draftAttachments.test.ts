import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, makeTestPluginDb, schema, type TestNodeContext, type TestPluginDb } from '@acorn/plugin-api/testkit'
import * as agentSchema from '../../node/schema'
import { AgentAttachmentStore } from './attachmentStore'
import { createDraftAttachments } from './draftAttachments'

// The `agents.draftAttachments` capability: what a plugin that edits an unsent image attachment may
// reach through this plugin, and everything it may not (../../contract/draftAttachments.ts).
//
// The interesting assertions are all refusals. The capability's whole job is to be narrower than the
// upload route beside it: one task, one unsent attachment, two image families, no path, and a source
// nobody may edit in place.
//
// Same two databases as attachmentStore.test.ts, for the same reason: the `tasks` row the upload guard
// checks is core's and the attachment rows are this plugin's.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const EDITED = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
const GIF = new TextEncoder().encode('GIF89a-------')

let host: TestNodeContext
let pluginDb: TestPluginDb
let store: AgentAttachmentStore
let drafts: ReturnType<typeof createDraftAttachments>

const task = (id: string) => ({
  id,
  title: id,
  origin: 'local' as const,
  projectId: 'project-app',
  branch: 'main',
  status: 'active' as const,
  sort: 0,
  createdAt: 1,
  updatedAt: 1,
})

beforeEach(async () => {
  // Through the testkit rather than by hand: `ctx.core` is the same CoreServices the host builds, and
  // the store's one core dependency is the `tasks` row its upload guard dereferences.
  host = makeTestNodeContext({ plugin: { name: 'agents' } })
  pluginDb = makeTestPluginDb('agents')
  await host.db.insert(schema.tasks).values([task('task'), task('other')])
  store = new AgentAttachmentStore(pluginDb.db, host.dataDir, host.core)
  drafts = createDraftAttachments(store)
})

afterEach(() => {
  pluginDb.cleanup()
  host.cleanup()
})

/** Claim an attachment for a turn, which is what makes it evidence rather than a draft. */
const reference = async (attachmentId: string): Promise<void> => {
  await pluginDb.db.insert(agentSchema.agentAttachmentRefs).values({ turnId: 'turn-1', attachmentId, position: 0 })
}

describe('reading a draft attachment', () => {
  it('hands over the bytes and the row, and no path', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    const read = await drafts.read({ taskId: 'task', attachmentId: source.id })
    expect(read?.bytes).toEqual(PNG)
    expect(read?.attachment).toMatchObject({ id: source.id, mediaType: 'image/png' })
    expect(Object.keys(read?.attachment ?? {})).not.toContain('localPath')
  })

  // Both halves of the key, always. A caller holding one task's id must not be able to read every
  // attachment on the node by guessing ids.
  it('refuses an attachment of another task', async () => {
    const source = await store.upload('other', 'shot.png', 'image/png', PNG)
    await expect(drafts.read({ taskId: 'task', attachmentId: source.id })).resolves.toBeNull()
  })

  it('refuses one a turn has already claimed, because that is the record of what was sent', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    await reference(source.id)
    await expect(drafts.read({ taskId: 'task', attachmentId: source.id })).resolves.toBeNull()
  })

  it('answers null for an id that never existed, rather than saying which kind of no it is', async () => {
    await expect(drafts.read({ taskId: 'task', attachmentId: 'nope' })).resolves.toBeNull()
  })
})

describe('creating a replacement', () => {
  it('stores a new attachment and leaves the source bytes untouched', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    const before = await store.resolve(source.id)
    const replacement = await drafts.createReplacement({
      taskId: 'task',
      sourceAttachmentId: source.id,
      filename: 'shot-annotated.png',
      mediaType: 'image/png',
      bytes: EDITED,
    })

    expect(replacement.id).not.toBe(source.id)
    expect(await readFile(before!.localPath)).toEqual(Buffer.from(PNG))
    expect(await store.get(source.id)).not.toBeNull()
  })

  // An edit that changed nothing hashes to the source, and content-addressed storage answers with the
  // source. The caller treats that as "no change" rather than swapping an attachment for itself.
  it('deduplicates identical bytes back to the source', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    const same = await drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'shot-annotated.png', mediaType: 'image/png', bytes: PNG,
    })
    expect(same.id).toBe(source.id)
  })

  it('refuses a source that belongs to another task', async () => {
    const source = await store.upload('other', 'shot.png', 'image/png', PNG)
    await expect(drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'x.png', mediaType: 'image/png', bytes: EDITED,
    })).rejects.toThrow(/unsent draft/)
  })

  // The race the whole compare-and-swap exists for: an editor stays open while a person draws, and the
  // turn can be sent in the meantime.
  it('refuses a source that has been sent since the editor opened', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    await reference(source.id)
    await expect(drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'x.png', mediaType: 'image/png', bytes: EDITED,
    })).rejects.toThrow(/unsent draft/)
  })

  // A GIF may be animated. Decoding one to a canvas and re-encoding would silently keep one frame, so
  // the answer is no rather than a quiet conversion.
  it('refuses bytes that are neither PNG nor JPEG', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    await expect(drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'x.gif', mediaType: 'image/png', bytes: GIF,
    })).rejects.toThrow(/PNG or a JPEG/)
  })

  it('refuses bytes that are not what the caller said they were', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    await expect(drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'x.png', mediaType: 'image/png', bytes: JPEG,
    })).rejects.toThrow(/image\/jpeg, not image\/png/)
  })

  it('normalizes the filename the same way an upload does', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    const replacement = await drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: '../../escaped.png', mediaType: 'image/png', bytes: EDITED,
    })
    expect(replacement.filename).toBe('escaped.png')
  })

  it('keeps the 10 MiB ceiling, which is the store’s and not this seam’s to relax', async () => {
    const source = await store.upload('task', 'shot.png', 'image/png', PNG)
    const huge = new Uint8Array(10 * 1024 * 1024 + 1)
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await expect(drafts.createReplacement({
      taskId: 'task', sourceAttachmentId: source.id, filename: 'x.png', mediaType: 'image/png', bytes: huge,
    })).rejects.toThrow(/10 MiB/)
  })
})
