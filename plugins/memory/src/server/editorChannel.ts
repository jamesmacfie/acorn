import type { IPty } from 'node-pty'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'

const frameSchema = z.discriminatedUnion('channel', [
  z.object({ channel: z.literal('memory:editor:open'), id: z.string().max(100), body: z.string().max(16384), cols: z.number(), rows: z.number() }),
  z.object({ channel: z.literal('memory:editor:input'), id: z.string(), data: z.string().max(65536) }),
  z.object({ channel: z.literal('memory:editor:resize'), id: z.string(), cols: z.number(), rows: z.number() }),
  z.object({ channel: z.literal('memory:editor:kill'), id: z.string() }),
])
const dimension = (value: number, max: number) => Math.max(2, Math.min(max, Math.trunc(value)))

// Edit a disposable body draft. Only the normal hash-checked Save can change durable memory.
export function registerMemoryEditor(events: CompiledPluginBroadcast) {
  const connections = new Map<object, Map<string, { pty: IPty | null; dir: string | null }>>()
  events.channel('memory', {
    onFrame(raw, send, connection) {
      const parsed = frameSchema.safeParse(raw)
      if (!parsed.success) return
      const frame = parsed.data
      const mine = connections.get(connection) ?? new Map<string, { pty: IPty | null; dir: string | null }>()
      connections.set(connection, mine)
      const slot = mine.get(frame.id)
      if (frame.channel === 'memory:editor:input') { slot?.pty?.write(frame.data); return }
      if (frame.channel === 'memory:editor:resize') { slot?.pty?.resize(dimension(frame.cols, 500), dimension(frame.rows, 300)); return }
      if (frame.channel === 'memory:editor:kill') { slot?.pty?.kill(); mine.delete(frame.id); return }
      if (mine.has(frame.id) || mine.size >= 2 || Buffer.byteLength(frame.body) > 16384) return
      const active = { pty: null as IPty | null, dir: null as string | null }
      mine.set(frame.id, active)
      void (async () => {
        let dir: string | undefined
        try {
          dir = await mkdtemp(join(tmpdir(), 'acorn-memory-editor-'))
          active.dir = dir
          const file = join(dir, 'body.md')
          await writeFile(file, frame.body, { mode: 0o600 })
          if (mine.get(frame.id) !== active) { await rm(dir, { recursive: true, force: true }); return }
          const { spawn } = await import('node-pty')
          if (mine.get(frame.id) !== active) { await rm(dir, { recursive: true, force: true }); return }
          active.pty = spawn(process.env.SHELL || '/bin/sh', ['-lc', 'exec ${EDITOR:-${VISUAL:-vi}} "$1"', 'acorn-memory-editor', file], {
            name: 'xterm-256color', cwd: dir, env: process.env as Record<string, string>, cols: dimension(frame.cols, 500), rows: dimension(frame.rows, 300),
          })
          active.pty.onData((data) => send({ channel: 'memory:editor:out', id: frame.id, data }))
          active.pty.onExit(({ exitCode }) => {
            void (async () => {
              try {
                const info = await stat(file)
                const body = info.size <= 16384 && exitCode === 0 ? await readFile(file, 'utf8') : undefined
                if (mine.get(frame.id) === active) send({ channel: 'memory:editor:exit', id: frame.id, code: body === undefined ? 1 : 0, body })
              } catch { if (mine.get(frame.id) === active) send({ channel: 'memory:editor:exit', id: frame.id, code: 1 }) }
              finally { if (mine.get(frame.id) === active) mine.delete(frame.id); await rm(dir!, { recursive: true, force: true }) }
            })()
          })
        } catch {
          const current = mine.get(frame.id) === active
          if (current) mine.delete(frame.id)
          if (dir) await rm(dir, { recursive: true, force: true })
          if (current) send({ channel: 'memory:editor:exit', id: frame.id, code: 1 })
        }
      })()
    },
    onDisconnect(connection) {
      const mine = connections.get(connection)
      for (const slot of mine?.values() ?? []) slot.pty?.kill()
      mine?.clear()
      connections.delete(connection)
    },
  })
}
