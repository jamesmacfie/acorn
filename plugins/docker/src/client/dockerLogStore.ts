// Session-only log buffers that outlive ContainerDetail: the WS log attachment stays open after
// the component unmounts, so returning to a Logs tab shows the same buffer (including a Clear)
// at the same spot instead of a fresh tail replay. Buffers are LRU-capped; a stream that ended
// (container stopped/removed) is reopened on next use so the attach replays a fresh tail.
import { createSignal, type Accessor } from 'solid-js'
import { wsDockerAttach } from './wsChannel'
import { LogTail } from '../shared/logTail'
import { dockerScopeKey, onDockerRetired } from './dockerScope'

const PUBLICATION_MS = 50 // Visible consumers project at most 20 times per second.
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
  const key = dockerScopeKey(target)
  let entry = buffers.get(key)
  if (entry?.ended()) {
    entry.detach()
    buffers.delete(key)
    entry = undefined
  }
  if (!entry) {
    const tail = new LogTail()
    const [version, setVersion] = createSignal(0)
    let timer: ReturnType<typeof setTimeout> | undefined
    const publish = () => { timer = undefined; setVersion(v => v + 1) }
    const text = () => { version(); return tail.text() }
    const setText = () => { tail.clear(); if (timer) clearTimeout(timer); publish() }
    const [ended, setEnded] = createSignal(false)
    const off = wsDockerAttach('logs', target, (event) => {
      if (event.kind === 'log') {
        tail.append(event.data)
        if (!timer) timer = setTimeout(publish, PUBLICATION_MS)
      }
      else if (event.kind === 'end') {
        if (timer) clearTimeout(timer)
        publish()
        setEnded(true)
      }
    })
    const detach = () => { off(); if (timer) clearTimeout(timer); timer = undefined; setEnded(true) }
    entry = { text, setText, ended, detach, stamp: 0 }
    buffers.set(key, entry)
    if (buffers.size > MAX_BUFFERS) {
      const oldest = [...buffers.entries()].filter(([id]) => id !== key).sort((a, b) => a[1].stamp - b[1].stamp)[0]
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

onDockerRetired(() => {
  for (const entry of buffers.values()) entry.detach()
  buffers.clear()
})
