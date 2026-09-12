import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'
import type { WsFrame } from '@acorn/protocol/ws.ts'
import { registerEditorWsChannel } from './wsChannel'
import type { EditorCoreServices } from './editor'

// The handoff end to end, with a shell script standing in for vim: the channel spawns whatever
// `$EDITOR` names, in the task's worktree, on the file the pane asked for, and the pane learns the
// process is gone from the exit frame. A fake editor that writes a marker is what proves the file the
// shell was handed is the file the pane meant.

let root = ''
const core = {
  tasks: { root: async () => root },
  fs: { resolveInRoot: (dir: string, relPath: string) => {
    const abs = resolve(dir, relPath)
    return abs.startsWith(`${dir}/`) ? abs : null
  } },
} as unknown as EditorCoreServices

// The channel handler, as the host would hand it one connection's frames.
const open = () => {
  let handler: Parameters<CompiledPluginBroadcast['channel']>[1] | undefined
  const events = { channel: (_prefix: string, h: typeof handler) => { handler = h } } as unknown as CompiledPluginBroadcast
  registerEditorWsChannel(events, core)
  const frames: WsFrame[] = []
  const conn = {}
  return {
    frames,
    conn,
    handler: handler!,
    send: (frame: WsFrame) => handler!.onFrame(frame, (out) => void frames.push(out), conn),
    exit: () => vi.waitFor(() => {
      const frame = frames.find((f) => f.channel === 'editor:pty:exit')
      if (!frame) throw new Error('no exit yet')
      return frame
    }, { timeout: 15_000 }),
  }
}

const env = { ...process.env }
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-editor-pty-'))
  await writeFile(join(root, 'a.ts'), 'const a = 1\n')
  // A login shell reads a profile, and this test must not depend on the one belonging to whoever is
  // running it — so `$HOME` is the temp worktree, which has no profile in it.
  process.env.SHELL = '/bin/sh'
  process.env.HOME = root
})
afterEach(() => {
  process.env = { ...env }
})

describe('the editor pane\'s $EDITOR handoff', () => {
  it('runs $EDITOR on the file and reports the exit, so the pane can re-read it', async () => {
    const editor = join(root, 'fake-editor.sh')
    await writeFile(editor, '#!/bin/sh\nprintf "// edited in \\$EDITOR\\n" >> "$1"\n', { mode: 0o755 })
    process.env.EDITOR = editor

    const channel = open()
    channel.send({ channel: 'editor:pty:open', ptyId: 'p1', taskId: 't1', path: 'a.ts', cols: 80, rows: 24 })

    expect(await channel.exit()).toMatchObject({ ptyId: 'p1', code: 0 })
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toContain('edited in $EDITOR')
  })

  it('reports a non-zero exit, and the file is untouched', async () => {
    const editor = join(root, 'refuses.sh')
    await writeFile(editor, '#!/bin/sh\nexit 3\n', { mode: 0o755 })
    process.env.EDITOR = editor

    const channel = open()
    channel.send({ channel: 'editor:pty:open', ptyId: 'p2', taskId: 't1', path: 'a.ts', cols: 80, rows: 24 })

    expect(await channel.exit()).toMatchObject({ ptyId: 'p2', code: 3 })
    expect(await readFile(join(root, 'a.ts'), 'utf8')).toBe('const a = 1\n')
  })

  it('refuses a path outside the worktree without spawning anything', async () => {
    process.env.EDITOR = '/bin/false'
    const channel = open()
    channel.send({ channel: 'editor:pty:open', ptyId: 'p3', taskId: 't1', path: '../outside.ts', cols: 80, rows: 24 })
    expect(await channel.exit()).toMatchObject({ ptyId: 'p3', code: 1 })
  })
})
