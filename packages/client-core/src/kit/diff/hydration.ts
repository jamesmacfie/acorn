import { createStore, reconcile } from 'solid-js/store'
import type { DiffFile } from './diffModel'
import type { ParsedFile } from './diffModel'

export type DiffHydrationStatus = 'idle' | 'queued' | 'loading' | 'loaded' | 'error'

const PATCH_BATCH_SIZE = 4
const BACKGROUND_BATCH_DELAY_MS = 80

type HydratorOptions = {
  /**
  /**
   * Turn a file's patch into rows. Async because tokenizing happens in a worker now
   * (highlight/worker.ts). This used to be a synchronous call plus a separate `tokenizerForFile`
   * hook, and the two collapsed into one when picking the tokenizer stopped being the hydrator's
   * business.
   */
  parseFile: (file: DiffFile) => ParsedFile | Promise<ParsedFile>
  onParsed: (parsed: ParsedFile) => void
  // Patch-body source, injected so the hydrator stays agnostic of where diffs come from (the PR
  // diff wires the query cache + batch endpoint; the compare preview has every body inline):
  /** Resolve a body for a file whose reset() snapshot entry has no patch (e.g. binary → null patch,
   * or a cache entry restored without bodies). Checked before fetchPatches. */
  cachedFile?: (path: string) => DiffFile | null
  /** Batch-fetch bodies still missing after cachedFile. Omitted → those files go to 'error'. */
  fetchPatches?: (paths: string[], signal: AbortSignal | undefined) => Promise<DiffFile[]>
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

const waitForIdle = () =>
  new Promise<void>((resolve) => {
    if (typeof window === 'undefined') {
      setTimeout(resolve, BACKGROUND_BATCH_DELAY_MS)
      return
    }
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 250 })
      return
    }
    setTimeout(resolve, BACKGROUND_BATCH_DELAY_MS)
  })

export function createDiffHydrator(options: HydratorOptions) {
  // Two views of the same fact, and both are load-bearing.
  //
  // The `Map` is the hydrator's own bookkeeping. Its queue loop reads it synchronously from whatever
  // reactive scope called `reset()`, and reading a store there would subscribe that scope to every
  // path in the diff — one publish would then re-run the effect that resets the hydrator.
  //
  // The store is what consumers read, one key per file. It replaced a single version counter, which
  // made every publish look like a change to every file: a viewer reading `status(path)` for 200
  // files in one memo rebuilt all 200 rows two or three times per file as they hydrated
  // (docs/diff-rendering.md § Parsing and highlighting).
  const statuses = new Map<string, DiffHydrationStatus>()
  const [published, setPublished] = createStore<Record<string, DiffHydrationStatus>>({})
  let fileByPath = new Map<string, DiffFile>()
  let queue: string[] = []
  let generation = 0
  let running = false
  let disposed = false
  let controller: AbortController | null = null

  const setStatus = (path: string, status: DiffHydrationStatus) => {
    statuses.set(path, status)
    setPublished(path, status)
  }

  const cachedFile = (path: string) => {
    const current = fileByPath.get(path)
    if (current?.patch != null) return current
    return options.cachedFile?.(path) ?? null
  }

  const enqueueFront = (paths: string[]) => {
    for (let i = paths.length - 1; i >= 0; i--) {
      const path = paths[i]!
      const status = statuses.get(path)
      if (status !== 'queued') continue
      queue = queue.filter((queued) => queued !== path)
      queue.unshift(path)
    }
  }

  const nextBatch = () => {
    const batch: string[] = []
    while (queue.length && batch.length < PATCH_BATCH_SIZE) {
      const path = queue.shift()!
      if (statuses.get(path) === 'queued') batch.push(path)
    }
    return batch
  }

  const hydrateBatch = async (paths: string[], run: number) => {
    if (run !== generation || disposed) return
    for (const path of paths) setStatus(path, 'loading')

    const signal = controller?.signal
    const cached: DiffFile[] = []
    const fetchPaths: string[] = []
    for (const path of paths) {
      const file = cachedFile(path)
      if (file) cached.push(file)
      else fetchPaths.push(path)
    }

    let fetched: DiffFile[] = []
    if (fetchPaths.length && options.fetchPatches) {
      fetched = await options.fetchPatches(fetchPaths, signal)
    }

    const byPath = new Map([...cached, ...fetched].map((file) => [file.path, file]))
    for (const path of paths) {
      if (run !== generation || disposed) return
      const file = byPath.get(path)
      if (!file) {
        setStatus(path, 'error')
        continue
      }
      const parsed = await options.parseFile(file)
      if (run !== generation || disposed) return
      options.onParsed(parsed)
      setStatus(path, 'loaded')
      await yieldToBrowser()
    }
  }

  const pump = async (run: number) => {
    if (running) return
    running = true
    let batchCount = 0
    try {
      while (!disposed && run === generation && queue.some((path) => statuses.get(path) === 'queued')) {
        if (batchCount > 0) {
          await Promise.race([waitForIdle(), sleep(BACKGROUND_BATCH_DELAY_MS)])
          if (run !== generation || disposed) break
        }
        const batch = nextBatch()
        if (!batch.length) break
        try {
          await hydrateBatch(batch, run)
        } catch (error) {
          if (run !== generation || disposed || controller?.signal.aborted) break
          for (const path of batch) {
            if (statuses.get(path) !== 'loaded') setStatus(path, 'error')
          }
          console.error('diff hydration failed', error)
        }
        batchCount++
      }
    } finally {
      if (run === generation) running = false
    }
  }

  const schedule = () => {
    void pump(generation)
  }

  const reset = (files: DiffFile[], priorityPath?: string) => {
    generation++
    controller?.abort()
    controller = new AbortController()
    running = false
    fileByPath = new Map(files.map((file) => [file.path, file]))
    statuses.clear()
    queue = files.map((file) => file.path)
    for (const file of files) statuses.set(file.path, 'queued')
    // One write for the new file set, rather than one per file: `reconcile` drops the paths that are
    // gone, adds the ones that are new, and leaves a file whose status has not changed alone.
    setPublished(reconcile(Object.fromEntries(statuses)))
    const first = priorityPath && fileByPath.has(priorityPath) ? priorityPath : files[0]?.path
    if (first) enqueueFront([first])
    schedule()
  }

  const prioritize = (paths: string | string[]) => {
    const list = (Array.isArray(paths) ? paths : [paths]).filter((path) => fileByPath.has(path))
    if (!list.length) return
    enqueueFront(list)
    schedule()
  }

  const retry = (path: string) => {
    if (!fileByPath.has(path)) return
    setStatus(path, 'queued')
    enqueueFront([path])
    schedule()
  }

  /** One file's status, tracked per path: a row reading this re-renders for its own file only. */
  const status = (path: string): DiffHydrationStatus => published[path] ?? 'idle'

  const dispose = () => {
    disposed = true
    generation++
    controller?.abort()
  }

  return { dispose, prioritize, reset, retry, status }
}
