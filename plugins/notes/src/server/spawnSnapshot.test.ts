import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NoteLocation } from '@acorn/protocol/notes.ts'
import { NotesStore } from './notes'
import { captureSpawnNotes } from './spawnSnapshot'

const parentTask: NoteLocation = { scope: 'task', taskId: 'parent' }
const childTask: NoteLocation = { scope: 'task', taskId: 'child' }
const workspace: NoteLocation = { scope: 'workspace', workspaceId: 'ws-1' }
const global: NoteLocation = { scope: 'global' }
const titles: Record<string, string> = { parent: 'Parent task', child: 'Child task', grandparent: 'Grandparent task' }

describe('notes a delegated agent starts with', () => {
  let dir: string
  let store: NotesStore
  const capture = (input: Parameters<typeof captureSpawnNotes>[1]) =>
    captureSpawnNotes(
      {
        store,
        workspaceIdOrNull: async () => 'ws-1',
        taskTitle: async (id) => titles[id] ?? null,
        notesAllowed: async (id) => id !== 'private',
      },
      input,
    )

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'spawn-notes-'))
    store = new NotesStore(dir)
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('takes included task, workspace, and global notes, and leaves out excluded, empty, and sibling notes', async () => {
    await store.create(parentTask, 'Git branches', { body: 'Never create a branch.' })
    await store.create(workspace, 'Style', { body: 'Use tabs.' })
    await store.create(global, 'Tone', { body: 'Be brief.' })
    await store.create(parentTask, 'Hidden', { body: 'Not for agents.', included: false })
    await store.create(parentTask, 'Empty')
    await store.create(workspace, 'Sibling seed', { body: 'Another task’s PR.', originTaskId: 'sibling' })

    const snapshot = await capture({ taskId: 'parent', parentTaskId: 'parent' })

    expect(snapshot.content).toContain('Your task is “Parent task”.')
    expect(snapshot.content).not.toContain('inherited')
    expect(snapshot.content).toMatch(
      /### Git branches \(scratch\)\n_Scope: task_\nNever create a branch\.\n### Style \(scratch\)\n_Scope: workspace_\nUse tabs\.\n### Tone \(scratch\)\n_Scope: everywhere_\nBe brief\./,
    )
    for (const absent of ['Not for agents', 'Empty', 'Another task']) expect(snapshot.content).not.toContain(absent)
  })

  it('gives a worktree child the delegating task’s notes, marked as inherited', async () => {
    await store.create(parentTask, 'Git branches', { body: 'Never create a branch.' })
    await store.create(childTask, 'Plan', { body: 'Child plan.' })

    const snapshot = await capture({ taskId: 'child', parentTaskId: 'parent' })

    expect(snapshot.content).toContain('Your task is “Child task”. A note marked “inherited”')
    expect(snapshot.content).toContain('that task’s branch and worktree are not yours')
    expect(snapshot.content).toMatch(/### Plan \(scratch\)\n_Scope: task_\n/)
    expect(snapshot.content).toMatch(/### Git branches \(scratch\)\n_Scope: task, inherited from task “Parent task”_\n/)
  })

  it('keeps notes with the same slug in different scopes apart', async () => {
    await store.create(parentTask, 'Rules', { body: 'Task rules.' })
    await store.create(workspace, 'Rules', { body: 'Workspace rules.' })
    await store.create(global, 'Rules', { body: 'Global rules.' })

    const { content } = await capture({ taskId: 'parent' })

    for (const body of ['Task rules.', 'Workspace rules.', 'Global rules.']) expect(content).toContain(body)
  })

  it('carries inherited notes forward once, and a fresh read of a source replaces its inherited copy', async () => {
    await store.create({ scope: 'task', taskId: 'grandparent' }, 'Old guidance', { body: 'From the top.' })
    await store.create(parentTask, 'Parent rule', { body: 'First version.' })
    await store.create(global, 'Tone', { body: 'Be brief.' })
    const first = await capture({ taskId: 'parent', parentTaskId: 'grandparent' })

    await store.write(parentTask, 'parent-rule', 'Second version.')
    await store.remove(global, 'tone')
    const second = await capture({ taskId: 'child', parentTaskId: 'parent', inherited: first.notes })

    expect(second.content).toContain('From the top.')
    expect(second.content).toContain('inherited from task “Grandparent task”')
    expect(second.content).toContain('Second version.')
    expect(second.content).not.toContain('First version.')
    expect(second.content).not.toContain('Be brief.')
    expect(second.content.match(/### Old guidance/g)).toHaveLength(1)
  })

  it('applies one budget across every source and says what it cut', async () => {
    for (let index = 0; index < 6; index++) await store.create(parentTask, `Parent ${index}`, { body: `p${index}` })
    for (let index = 0; index < 6; index++) await store.create(childTask, `Child ${index}`, { body: `c${index}` })
    await store.create(childTask, 'Long', { body: 'x'.repeat(5_000) })

    const snapshot = await capture({ taskId: 'child', parentTaskId: 'parent' })

    expect(snapshot.notes).toHaveLength(10)
    expect(snapshot.content).toContain('- … 3 more omitted')
    expect(snapshot.content).toContain('- 1 note was cut to 2000 bytes.')
  })

  it('attaches nothing when core’s snapshot hook keeps notes out of the child’s task', async () => {
    await store.create(parentTask, 'Git branches', { body: 'Never create a branch.' })
    expect(await capture({ taskId: 'private', parentTaskId: 'parent' })).toMatchObject({ content: '', notes: [] })
  })

  it('drops stored notes it cannot parse and attaches nothing when no note applies', async () => {
    const snapshot = await capture({ taskId: 'child', parentTaskId: 'parent', inherited: [{ scope: 'nowhere' }, 7] })
    expect(snapshot).toMatchObject({ content: '', notes: [] })
  })
})
