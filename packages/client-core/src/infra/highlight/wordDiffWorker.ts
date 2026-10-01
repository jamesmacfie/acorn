import { measure, recordSample } from '../telemetry/emitter'
import { wordDiffBatch, type DiffWordsDocument, type WordDiffOutput } from '../../kit/diff/wordDiff'
import type { WordDiffRequest, WordDiffResponse } from './wordDiffMessages'
import { createDocumentWorker } from './documentWorker'

export type { DiffWordsDocument } from '../../kit/diff/wordDiff'

const owner = createDocumentWorker<WordDiffRequest, WordDiffResponse, WordDiffOutput[]>({
  load: () => import('./wordDiff.worker?worker'),
  response: (message) => message.ok ? { kind: 'value', value: message.results } : { kind: 'fallback' },
})

/** Compute paired word diffs without replaying a deadline batch on the renderer. */
export const diffWordsDocument: DiffWordsDocument = async (pairs) => {
  if (!pairs.length) return []
  recordSample('core', 'diff.words.pairs', pairs.length)
  const result = await owner.request((id) => ({ id, pairs }))
  if (result.kind === 'value') return result.value
  if (result.kind === 'degraded') return []
  try { return measure('core', 'diff.words.main_thread', () => wordDiffBatch(pairs)) }
  catch { return [] }
}

/** Tests only: settle and retire this generation before trying a fresh worker. */
export const resetWordDiffWorker = owner.reset
