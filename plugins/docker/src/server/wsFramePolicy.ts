import type { WsClientFrame } from '@acorn/protocol/ws.ts'
import type { DockerClientFrame } from '../shared/wsFrames'
import { isDockerRef } from '../shared/model'

export const MAX_DOCKER_EXEC_ID_CHARS = 128
export const MAX_DOCKER_INPUT_BYTES = 64 * 1024

const execId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= MAX_DOCKER_EXEC_ID_CHARS
const dimension = (value: unknown): value is number | undefined => value === undefined || (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value))

// Every payload reaches native process methods, so validate each operation independently. Zero or
// omitted dimensions retain the established defaults; other integers retain engine clamping.
export function parseDockerFrame(frame: WsClientFrame): DockerClientFrame | null {
  const { channel, id, ref, cols, rows, data } = frame
  switch (channel) {
    case 'docker:logs:attach':
    case 'docker:logs:detach':
    case 'docker:stats:attach':
    case 'docker:stats:detach':
      return typeof id === 'string' && isDockerRef(id) ? { channel, id } : null
    case 'docker:exec:open':
      return execId(frame.execId) && typeof ref === 'string' && isDockerRef(ref) && dimension(cols) && dimension(rows)
        ? { channel, execId: frame.execId, ref, cols: cols ?? 80, rows: rows ?? 24 } : null
    case 'docker:exec:resize':
      return execId(frame.execId) && dimension(cols) && dimension(rows)
        ? { channel, execId: frame.execId, cols: cols ?? 80, rows: rows ?? 24 } : null
    case 'docker:exec:in':
      return execId(frame.execId) && typeof data === 'string' && Buffer.byteLength(data) <= MAX_DOCKER_INPUT_BYTES
        ? { channel, execId: frame.execId, data } : null
    case 'docker:exec:kill':
      return execId(frame.execId) ? { channel, execId: frame.execId } : null
    default:
      return null
  }
}
