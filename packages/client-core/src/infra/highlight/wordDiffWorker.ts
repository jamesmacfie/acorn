import { measure, recordSample } from '../telemetry/emitter'
import { registerPageFact } from '../telemetry/pageFacts'
import { wordDiffBatch, type DiffWordsDocument, type WordDiffInput, type WordDiffOutput } from '../../kit/diff/wordDiff'
import type { WordDiffRequest, WordDiffResponse } from './wordDiffMessages'

export type { DiffWordsDocument } from '../../kit/diff/wordDiff'

type Pending = { resolve: (results: WordDiffOutput[] | null) => void }
const WORD_DIFF_TIMEOUT_MS = 10_000

let state: 'cold' | 'live' | 'dead' = 'cold'
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()
registerPageFact('ui.page.workers.word_diff', () => (worker ? 1 : 0))

const failAll = () => {
  for (const request of pending.values()) request.resolve(null)
  pending.clear()
}

const kill = () => {
  state = 'dead'
  worker?.terminate()
  worker = null
  failAll()
}

async function spawn(): Promise<Worker | null> {
  if (state === 'dead' || typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    const { default: WordDiffWorker } = await import('./wordDiff.worker?worker')
    const spawned = new WordDiffWorker()
    spawned.onmessage = (event: MessageEvent<WordDiffResponse>) => {
      const message = event.data
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) {
        state = 'live'
        request.resolve(message.results)
      } else {
        request.resolve(null)
      }
    }
    spawned.onerror = kill
    worker = spawned
    return spawned
  } catch {
    kill()
    return null
  }
}

const onMainThread = (pairs: WordDiffInput[]) =>
  measure('core', 'diff.words.main_thread', () => wordDiffBatch(pairs))

/** Compute all paired delete/insert word diffs for one file away from the renderer thread. */
export const diffWordsDocument: DiffWordsDocument = async (pairs) => {
  if (!pairs.length) return []
  const activeWorker = await spawn()
  if (!activeWorker) return onMainThread(pairs)

  const id = nextId++
  const request: WordDiffRequest = { id, pairs }
  recordSample('core', 'diff.words.pairs', pairs.length)
  const results = await new Promise<WordDiffOutput[] | null>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve(null)
    }, WORD_DIFF_TIMEOUT_MS)
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer)
        resolve(value)
      },
    })
    activeWorker.postMessage(request)
  })
  return results ?? onMainThread(pairs)
}

/** Tests only: forget the worker so the next call re-evaluates the environment. */
export const resetWordDiffWorker = () => {
  worker?.terminate()
  worker = null
  state = 'cold'
  pending.clear()
}
