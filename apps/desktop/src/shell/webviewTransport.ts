import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { latestSignal, type LatestSignal } from '@acorn/client-core/kit/lib/latestSignal'

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

// One page's owner. Evicting the page aborts it, and so does evicting every preview.
type Lifetime = { owner: LatestSignal; tail: Promise<unknown> }
const lifetimes = new Map<string, Lifetime>()
const previewOwner = latestSignal()
let previewRetirement: Promise<unknown> = Promise.resolve()
const lifetime = (key: string) => {
  let entry = lifetimes.get(key)
  if (!entry) lifetimes.set(key, entry = { owner: latestSignal(), tail: Promise.resolve() })
  return entry
}

// Serial ordering covers ensure, visibility, and retirement. Eviction invalidates queued work
// immediately, so an old owner cannot recreate or show a replacement page after a Node switch.
export function webviewOperation<T>(key: string, command: string, args: object = {}): Promise<T | false> {
  const entry = lifetime(key)
  const owned = entry.owner.signal
  const previews = previewOwner.signal
  const retirement = key.startsWith('preview:') ? previewRetirement : undefined
  const current = () => !owned.aborted && (!retirement || !previews.aborted)
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
  lifetime(key).owner.next()
  void webviewOperation(key, 'webview_evict').catch(() => undefined)
}

export function evictPreviews(): void {
  previewOwner.next()
  const pending = [previewRetirement]
  for (const [key, entry] of lifetimes) {
    if (!key.startsWith('preview:')) continue
    entry.owner.next()
    pending.push(entry.tail)
  }
  // Native records can outlive a renderer reload and therefore be absent from this tracking map.
  // New owners wait for the shell's family retirement as well as their own key's pending commands.
  previewRetirement = Promise.allSettled(pending).then(() => invoke('webview_evict_previews'))
  void previewRetirement.catch(() => undefined)
}
