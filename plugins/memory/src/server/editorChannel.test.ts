import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'
import { registerMemoryEditor } from './editorChannel'

it('returns the edited body draft and removes its temporary directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'memory-editor-test-'))
  const editor = join(root, 'editor.sh')
  await writeFile(editor, '#!/bin/sh\ncat "$1"\nprintf "Edited body.\\n" > "$1"\nprintf "\\n%s\\n" "$PWD"\n', { mode: 0o700 })
  vi.stubEnv('EDITOR', editor)
  vi.stubEnv('SHELL', '/bin/sh')
  let handler!: Parameters<CompiledPluginBroadcast['channel']>[1]
  const frames: { channel: string; data?: string; body?: string; code?: number }[] = []
  const connection = {}
  registerMemoryEditor({ channel: (_prefix, value) => { handler = value } } as CompiledPluginBroadcast)
  try {
    handler.onFrame({ channel: 'memory:editor:open', id: 'draft-1', body: 'Original body.', cols: 80, rows: 24 }, frame => frames.push(frame), connection)
    await vi.waitFor(() => expect(frames.find(frame => frame.channel === 'memory:editor:exit')).toMatchObject({ code: 0, body: 'Edited body.\n' }), { timeout: 5000 })
    const output = frames.filter(frame => frame.data).map(frame => frame.data).join('')
    expect(output).toContain('Original body.')
    const draftDir = output.split(/\r?\n/).find(line => line.includes('acorn-memory-editor-'))!
    expect(draftDir).toBeTruthy()
    await vi.waitFor(async () => expect(await access(draftDir).then(() => true, () => false)).toBe(false))
  } finally { handler.onDisconnect(connection); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
})
