import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

export type WebviewState = { key: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

// Register before ensure can replay state. Observers join synchronously and leave synchronously,
// even though Tauri's listener registration crosses an asynchronous boundary.
const observers = new Set<(state: WebviewState) => void>()
let listening: Promise<unknown> | undefined
const stateReady = () => listening ??= listen<WebviewState>('acorn:webview-state', ({ payload }) => {
  for (const observer of observers) observer(payload)
}).catch((error) => {
  listening = undefined
  throw error
})

export function onWebviewState(cb: (state: WebviewState) => void, matches: (key: string) => boolean): () => void {
  const observer = (state: WebviewState) => { if (matches(state.key)) cb(state) }
  observers.add(observer)
  return () => { observers.delete(observer) }
}

type Lifetime = { generation: number; tail: Promise<unknown> }
const lifetimes = new Map<string, Lifetime>()
let previewGeneration = 0
let previewRetirement: Promise<unknown> = Promise.resolve()
const lifetime = (key: string) => {
  let entry = lifetimes.get(key)
  if (!entry) lifetimes.set(key, entry = { generation: 0, tail: Promise.resolve() })
  return entry
}

// Serial ordering covers ensure, visibility, and retirement. Eviction invalidates queued work
// immediately, so an old owner cannot recreate or show a replacement page after a Node switch.
export function webviewOperation<T>(key: string, command: string, args: object = {}): Promise<T | false> {
  const entry = lifetime(key)
  const generation = entry.generation
  const ownerGeneration = previewGeneration
  const retirement = key.startsWith('preview:') ? previewRetirement : undefined
  const current = () => generation === entry.generation && (!retirement || ownerGeneration === previewGeneration)
  const result = entry.tail.then(async () => {
    if (!current()) return false
    await retirement
    if (!current()) return false
    if (command === 'webview_ensure') await stateReady()
    if (!current()) return false
    const value = await invoke<T>(command, { key, ...args })
    return current() ? value : false
  })
  entry.tail = result.catch(() => undefined)
  return result
}

export function evictWebview(key: string): void {
  const entry = lifetime(key)
  entry.generation += 1
  void webviewOperation(key, 'webview_evict').catch(() => undefined)
}

export function evictPreviews(): void {
  previewGeneration += 1
  const pending = [previewRetirement]
  for (const [key, entry] of lifetimes) {
    if (!key.startsWith('preview:')) continue
    entry.generation += 1
    pending.push(entry.tail)
  }
  // Native records can outlive a renderer reload and therefore be absent from this tracking map.
  // New owners wait for the shell's family retirement as well as their own key's pending commands.
  previewRetirement = Promise.allSettled(pending).then(() => invoke('webview_evict_previews'))
  void previewRetirement.catch(() => undefined)
}
