// Adapts the wsHub channel-handler registry to the docker streams: log/stats children plus
// interactive `docker exec` PTYs (node-pty — `-it` needs a real tty). Everything is keyed by
// connection and torn down on detach/kill/disconnect. Refs are shape-validated here — they reach argv.
import { spawn as ptySpawn, type IPty } from 'node-pty'
import { registerWsChannelHandler } from '../../../core/main/wsHub'
import { isDockerRef } from '../shared/model'
import { dockerEnv } from './cli'
import { parseStatsLine } from './parse'
import { getDockerService } from './dockerService'

type StreamKey = string // `${kind}:${ref}`
const MAX_EXECS_PER_CONN = 8

// Try bash, fall back to sh — works across alpine/debian-ish images.
const EXEC_SHELL = 'command -v bash >/dev/null && exec bash || exec sh'

export function registerDockerWsChannel(): void {
  const service = getDockerService()
  const streamSubs = new Map<object, Map<StreamKey, { stop(): void }>>()
  const execSubs = new Map<object, Map<string, IPty>>()

  const stopAll = (conn: object) => {
    for (const handle of streamSubs.get(conn)?.values() ?? []) handle.stop()
    streamSubs.delete(conn)
    for (const pty of execSubs.get(conn)?.values() ?? []) pty.kill()
    execSubs.delete(conn)
  }

  registerWsChannelHandler('docker', {
    onFrame(frame, send, conn) {
      switch (frame.channel) {
        case 'docker:logs:attach':
        case 'docker:stats:attach':
        case 'docker:logs:detach':
        case 'docker:stats:detach': {
          const { id } = frame
          if (typeof id !== 'string' || !isDockerRef(id)) return
          const kind = frame.channel.startsWith('docker:logs') ? 'logs' as const : 'stats' as const
          const key: StreamKey = `${kind}:${id}`
          const mine = streamSubs.get(conn) ?? new Map<StreamKey, { stop(): void }>()
          streamSubs.set(conn, mine)
          if (frame.channel.endsWith(':detach')) {
            mine.get(key)?.stop()
            mine.delete(key)
            return
          }
          if (mine.has(key)) return // attach is idempotent per connection
          const handle = service.openStream(
            kind,
            id,
            (line) => {
              if (kind === 'logs') return send({ channel: 'docker:log', id, data: line })
              const sample = parseStatsLine(line)
              if (sample) send({ channel: 'docker:stats', id, sample })
            },
            () => {
              mine.delete(key)
              send({ channel: 'docker:stream-end', id, kind })
            },
          )
          mine.set(key, handle)
          return
        }
        case 'docker:exec:open': {
          const { execId, ref, cols, rows } = frame
          if (typeof execId !== 'string' || typeof ref !== 'string' || !isDockerRef(ref)) return
          const mine = execSubs.get(conn) ?? new Map<string, IPty>()
          execSubs.set(conn, mine)
          if (mine.has(execId) || mine.size >= MAX_EXECS_PER_CONN) return
          let pty: IPty
          try {
            pty = ptySpawn('docker', ['exec', '-it', ref, 'sh', '-c', EXEC_SHELL], {
              name: 'xterm-256color',
              cols: Math.max(2, Math.min(500, cols || 80)),
              rows: Math.max(2, Math.min(300, rows || 24)),
              env: dockerEnv() as Record<string, string>,
            })
          } catch {
            return send({ channel: 'docker:exec:exit', execId })
          }
          mine.set(execId, pty)
          pty.onData((data) => send({ channel: 'docker:exec:out', execId, data }))
          pty.onExit(() => {
            mine.delete(execId)
            send({ channel: 'docker:exec:exit', execId })
          })
          return
        }
        case 'docker:exec:in':
          execSubs.get(conn)?.get(frame.execId)?.write(frame.data)
          return
        case 'docker:exec:resize': {
          const pty = execSubs.get(conn)?.get(frame.execId)
          if (pty) pty.resize(Math.max(2, Math.min(500, frame.cols || 80)), Math.max(2, Math.min(300, frame.rows || 24)))
          return
        }
        case 'docker:exec:kill':
          execSubs.get(conn)?.get(frame.execId)?.kill()
          return
        default:
          return
      }
    },
    onDisconnect: stopAll,
  })
}
