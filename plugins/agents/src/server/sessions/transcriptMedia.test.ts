import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  makeTestNodeContext,
  makeTestPluginDb,
  schema,
  type TestNodeContext,
  type TestPluginDb,
} from '@acorn/plugin-api/testkit'
import { MAX_TRANSCRIPT_MEDIA_READ_BYTES } from '../../contract/transcriptMedia'
import * as agentSchema from '../../node/schema'
import { AgentArtifactStore } from './artifactStore'
import { AgentAttachmentStore } from './attachmentStore'
import { createTranscriptMedia } from './transcriptMedia'

// The `agents.transcriptMedia` capability: what a plugin drawing a sent attachment or an artifact may
// read, and everything it may not (../../contract/transcriptMedia.ts).
//
// Most assertions are refusals. The caller names a task, a session, a kind and an id, and every one of
// the four has to agree with the stored rows before any bytes come back.

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

let host: TestNodeContext
let pluginDb: TestPluginDb
let attachments: AgentAttachmentStore
let artifacts: AgentArtifactStore
let media: ReturnType<typeof createTranscriptMedia>

// Two sessions on `task`, one on `other`. The session table itself is the runtime's; this capability
// only asks it which task a session belongs to.
const sessions = new Map([
  ['session', 'task'],
  ['sibling', 'task'],
  ['foreign', 'other'],
])

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
  host = makeTestNodeContext({ plugin: { name: 'agents' } })
  pluginDb = makeTestPluginDb('agents')
  await host.db.insert(schema.tasks).values([task('task'), task('other')])
  attachments = new AgentAttachmentStore(pluginDb.db, host.dataDir, host.core)
  artifacts = new AgentArtifactStore(pluginDb.db, host.dataDir)
  media = createTranscriptMedia({ taskIdForSession: async (id) => sessions.get(id) ?? null, attachments, artifacts })
})

afterEach(() => {
  pluginDb.cleanup()
  host.cleanup()
})

let ordinal = 0
/** A turn of `sessionId` that sent this attachment. */
const send = async (sessionId: string, attachmentId: string): Promise<void> => {
  const turnId = `turn-${++ordinal}`
  await pluginDb.db.insert(agentSchema.agentTurns).values({
    id: turnId,
    sessionId,
    ordinal,
    source: 'interactive',
    status: 'completed',
    inputJson: '[]',
    idempotencyKey: turnId,
    createdAt: 1,
  })
  await pluginDb.db.insert(agentSchema.agentAttachmentRefs).values({ turnId, attachmentId, position: 0 })
}

const rows = async () => ({
  attachments: await pluginDb.db.select().from(agentSchema.agentAttachments),
  artifacts: await pluginDb.db.select().from(agentSchema.agentArtifacts),
})

describe('a sent attachment', () => {
  it('hands over the descriptor and the bytes, and no path', async () => {
    const sent = await attachments.upload('task', 'shot.png', 'image/png', PNG)
    await send('session', sent.id)
    const read = await media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: sent.id })
    expect(read).toEqual({
      media: {
        kind: 'attachment',
        id: sent.id,
        filename: 'shot.png',
        mediaType: 'image/png',
        byteSize: PNG.byteLength,
      },
      bytes: PNG,
    })
  })

  it('refuses an attachment no turn of that session sent', async () => {
    const draft = await attachments.upload('task', 'draft.png', 'image/png', PNG)
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: draft.id }),
    ).resolves.toBeNull()
    await send('sibling', draft.id)
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: draft.id }),
    ).resolves.toBeNull()
  })

  it('refuses another task, even through a session that task owns', async () => {
    const theirs = await attachments.upload('other', 'shot.png', 'image/png', PNG)
    await send('foreign', theirs.id)
    await expect(
      media.read({ taskId: 'task', sessionId: 'foreign', kind: 'attachment', id: theirs.id }),
    ).resolves.toBeNull()
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: theirs.id }),
    ).resolves.toBeNull()
  })

  it('refuses a deleted row and a row whose content is gone', async () => {
    const sent = await attachments.upload('task', 'shot.png', 'image/png', PNG)
    await send('session', sent.id)
    const path = (await attachments.resolve(sent.id))!.localPath
    await unlink(path)
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: sent.id }),
    ).resolves.toBeNull()
    await pluginDb.db
      .update(agentSchema.agentAttachments)
      .set({ deletedAt: 2 })
      .where(eq(agentSchema.agentAttachments.id, sent.id))
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: sent.id }),
    ).resolves.toBeNull()
  })
})

describe('an artifact', () => {
  it('hands over its own session’s artifact under its media type without parameters', async () => {
    const output = await artifacts.putText({
      sessionId: 'session',
      turnId: null,
      kind: 'command_output',
      title: 'Output',
      text: 'hello',
    })
    const read = await media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: output.id })
    expect(read?.media).toEqual({
      kind: 'artifact',
      id: output.id,
      filename: 'Output',
      mediaType: 'text/plain',
      byteSize: 5,
    })
    expect(new TextDecoder().decode(read!.bytes!)).toBe('hello')
  })

  it('refuses another session’s artifact, the wrong task, and the wrong kind', async () => {
    const output = await artifacts.putText({
      sessionId: 'sibling',
      turnId: null,
      kind: 'command_output',
      title: 'Output',
      text: 'hello',
    })
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: output.id }),
    ).resolves.toBeNull()
    await expect(
      media.read({ taskId: 'other', sessionId: 'sibling', kind: 'artifact', id: output.id }),
    ).resolves.toBeNull()
    await expect(
      media.read({ taskId: 'task', sessionId: 'sibling', kind: 'attachment', id: output.id }),
    ).resolves.toBeNull()
  })

  it('answers null for an unknown id or session, rather than saying which kind of no it is', async () => {
    await expect(media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: 'nope' })).resolves.toBeNull()
    await expect(media.read({ taskId: 'task', sessionId: 'nope', kind: 'artifact', id: 'nope' })).resolves.toBeNull()
  })

  it('names content over the bridge cap without reading it, and leaves the download to the owner', async () => {
    const large = await artifacts.putBytes({
      sessionId: 'session',
      turnId: null,
      kind: 'file',
      title: 'dump.bin',
      mediaType: 'application/octet-stream',
      bytes: new Uint8Array(MAX_TRANSCRIPT_MEDIA_READ_BYTES + 1),
    })
    await expect(media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: large.id })).resolves.toEqual(
      {
        media: {
          kind: 'artifact',
          id: large.id,
          filename: 'dump.bin',
          mediaType: 'application/octet-stream',
          byteSize: MAX_TRANSCRIPT_MEDIA_READ_BYTES + 1,
        },
        bytes: null,
      },
    )
  })

  it('reads a missing object as absent', async () => {
    const output = await artifacts.putText({
      sessionId: 'session',
      turnId: null,
      kind: 'command_output',
      title: 'Output',
      text: 'gone',
    })
    const [row] = await pluginDb.db
      .select()
      .from(agentSchema.agentArtifacts)
      .where(eq(agentSchema.agentArtifacts.id, output.id))
    await unlink(join(artifacts.root, row!.storageKey!))
    await expect(
      media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: output.id }),
    ).resolves.toBeNull()
  })
})

// Stored media is the record of a turn. Reading it, and scribbling on what came back, changes nothing.
it('leaves every row and every stored byte as it found them', async () => {
  const sent = await attachments.upload('task', 'shot.png', 'image/png', PNG)
  await send('session', sent.id)
  const output = await artifacts.putText({
    sessionId: 'session',
    turnId: null,
    kind: 'command_output',
    title: 'Output',
    text: 'hello',
  })
  const before = await rows()

  const read = await media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: sent.id })
  read!.bytes!.fill(0)
  await media.read({ taskId: 'task', sessionId: 'session', kind: 'artifact', id: output.id })

  expect(await rows()).toEqual(before)
  expect(await readFile((await attachments.resolve(sent.id))!.localPath)).toEqual(Buffer.from(PNG))
  expect((await media.read({ taskId: 'task', sessionId: 'session', kind: 'attachment', id: sent.id }))?.bytes).toEqual(
    PNG,
  )
})
