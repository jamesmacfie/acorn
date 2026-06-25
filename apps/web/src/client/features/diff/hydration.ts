import type { QueryClient } from '@tanstack/solid-query'
import { createSignal } from 'solid-js'
import { filesKey } from '../../../shared/api'
import { fetchFilePatches, filePatchKey, type PullFile } from '../../queries'
import type { ParsedFile, TokenizeLine } from './model'

export type DiffHydrationStatus = 'idle' | 'queued' | 'loading' | 'loaded' | 'error'

const PATCH_BATCH_SIZE = 4
const BACKGROUND_BATCH_DELAY_MS = 80

type HydratorOptions = {
  owner: string
  repo: string
  number: string
  queryClient: QueryClient
  tokenizerForFile: (file: PullFile) => Promise<TokenizeLine>
  parseFile: (file: PullFile, tokenize: TokenizeLine) => ParsedFile
  onParsed: (parsed: ParsedFile) => void
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
  const [version, setVersion] = createSignal(0)
  const statuses = new Map<string, DiffHydrationStatus>()
  let fileByPath = new Map<string, PullFile>()
  let queue: string[] = []
  let generation = 0
  let running = false
  let disposed = false
  let controller: AbortController | null = null

  const publish = () => setVersion((v) => v + 1)
  const setStatus = (path: string, status: DiffHydrationStatus) => {
    statuses.set(path, status)
  }

  const cachedFile = (path: string) => {
    const current = fileByPath.get(path)
    if (current?.patch != null) return current
    const direct = options.queryClient.getQueryData<PullFile>(filePatchKey(options.owner, options.repo, options.number, path))
    if (direct) return direct
    const warmed = options.queryClient.getQueryData<PullFile[]>(filesKey(options.owner, options.repo, options.number))
    return warmed?.find((file) => file.path === path) ?? null
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
    publish()

    const signal = controller?.signal
    const cached: PullFile[] = []
    const fetchPaths: string[] = []
    for (const path of paths) {
      const file = cachedFile(path)
      if (file) cached.push(file)
      else fetchPaths.push(path)
    }

    let fetched: PullFile[] = []
    if (fetchPaths.length) {
      fetched = await fetchFilePatches(options.owner, options.repo, options.number, fetchPaths, signal)
      for (const file of fetched) {
        options.queryClient.setQueryData(filePatchKey(options.owner, options.repo, options.number, file.path), file)
      }
    }

    const byPath = new Map([...cached, ...fetched].map((file) => [file.path, file]))
    for (const path of paths) {
      if (run !== generation || disposed) return
      const file = byPath.get(path)
      if (!file) {
        setStatus(path, 'error')
        publish()
        continue
      }
      const tokenize = await options.tokenizerForFile(file)
      if (run !== generation || disposed) return
      options.onParsed(options.parseFile(file, tokenize))
      setStatus(path, 'loaded')
      publish()
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
          publish()
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

  const reset = (files: PullFile[], priorityPath?: string) => {
    generation++
    controller?.abort()
    controller = new AbortController()
    running = false
    fileByPath = new Map(files.map((file) => [file.path, file]))
    statuses.clear()
    queue = files.map((file) => file.path)
    for (const file of files) setStatus(file.path, 'queued')
    const first = priorityPath && fileByPath.has(priorityPath) ? priorityPath : files[0]?.path
    if (first) enqueueFront([first])
    publish()
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
    publish()
    schedule()
  }

  const status = (path: string): DiffHydrationStatus => {
    version()
    return statuses.get(path) ?? 'idle'
  }

  const dispose = () => {
    disposed = true
    generation++
    controller?.abort()
  }

  return { dispose, prioritize, reset, retry, status }
}
