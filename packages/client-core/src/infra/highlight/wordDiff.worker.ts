import { wordDiffBatch } from '../../kit/diff/wordDiff'
import type { WordDiffRequest, WordDiffResponse } from './wordDiffMessages'

const post = (message: WordDiffResponse) => (self as unknown as Worker).postMessage(message)

self.onmessage = (event: MessageEvent<WordDiffRequest>) => {
  const { id, pairs } = event.data
  try {
    post({ id, ok: true, results: wordDiffBatch(pairs) })
  } catch (error) {
    post({ id, ok: false, error: String((error as Error)?.message ?? error) })
  }
}
