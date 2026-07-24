// Session-only log buffers that outlive ContainerDetail: the WS log attachment stays open after
// the component unmounts, so returning to a Logs tab shows the same buffer (including a Clear)
// at the same spot instead of a fresh tail replay. Buffers are LRU-capped; a stream that ended
// (container stopped/removed) is reopened on next use so the attach replays a fresh tail.
import { createSignal, type Accessor } from 'solid-js'
import { wsDockerAttach } from '../../../core/client/wsClient'

const MAX_LOG_CHARS = 512 * 1024 // char-capped ring; virtualize if huge logs ever matter
const MAX_BUFFERS = 8 // LRU cap on background `docker logs -f` attachments

type Entry = {
  text: Accessor<string>
  setText: (t: string) => void
  ended: Accessor<boolean>
  detach: () => void
  stamp: number
}

export type DockerLogBuffer = { text: Accessor<string>; ended: Accessor<boolean>; clear: () => void }

let clock = 0
const buffers = new Map<string, Entry>()

export function dockerLogBuffer(target: string): DockerLogBuffer {
  let entry = buffers.get(target)
  if (entry?.ended()) {
    entry.detach()
    buffers.delete(target)
    entry = undefined
  }
  if (!entry) {
    const [text, setText] = createSignal('')
    const [ended, setEnded] = createSignal(false)
    const detach = wsDockerAttach('logs', target, (event) => {
      if (event.kind === 'log') setText((t) => (t + event.data).slice(-MAX_LOG_CHARS))
      else if (event.kind === 'end') setEnded(true)
    })
    entry = { text, setText, ended, detach, stamp: 0 }
    buffers.set(target, entry)
    if (buffers.size > MAX_BUFFERS) {
      const oldest = [...buffers.entries()].filter(([key]) => key !== target).sort((a, b) => a[1].stamp - b[1].stamp)[0]
      if (oldest) {
        oldest[1].detach()
        buffers.delete(oldest[0])
      }
    }
  }
  const live = entry
  live.stamp = ++clock
  return { text: live.text, ended: live.ended, clear: () => live.setText('') }
}
