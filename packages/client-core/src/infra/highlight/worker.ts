import { measure, recordDuration, recordSample, telemetryEnabled } from '../telemetry/emitter'
// The main-thread half of the highlight worker: one worker, lazily spawned, requests matched to
// replies by id. See docs/diff-rendering.md § Syntax highlighting for why every caller sends a
// whole document (for a diff, one side of one hunk: kit/diff/diffModel.ts § enrichDiffRows) rather
// than a line.
import { getHighlighter } from './shiki'
import { langFor } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './messages'
import { createLogger } from '../telemetry/logger'
import { createDocumentWorker } from './documentWorker'
import { registerPageFact } from '../telemetry/pageFacts'

const log = createLogger('highlight')

/** Tokenize a whole document. `path` only picks the grammar; `code` is newline-separated source. */
export type TokenizeDocument = (path: string, code: string) => Promise<HighlightLines>

const plain = (code: string): HighlightLines => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])

const owner = createDocumentWorker<HighlightRequest, HighlightResponse, HighlightLines>({
  load: () => import('./highlighter.worker?worker'),
  response: (message) => {
    if (message.queueMs !== undefined) recordDuration('core', 'highlight.queue.wait', message.queueMs)
    if (message.executionMs !== undefined) recordDuration('core', 'highlight.worker.execute', message.executionMs)
    recordSample('core', 'highlight.result', 1, '1', { outcome: message.ok ? 'worker' : 'grammar-error' })
    return message.ok ? { kind: 'value', value: message.lines } : { kind: 'fallback' }
  },
  unavailable: (reason) => log.error(`worker unavailable, falling back to the main thread: ${reason}`),
  timeout: () => recordSample('core', 'highlight.timeout', 1),
  pending: (count) => recordSample('core', 'highlight.pending', count),
})

/**
 * Tokenize on the main thread. The fallback, not the path: it uses the JavaScript regex engine (the
 * only one the document's CSP permits) and tokenizes line by line, so multi-line constructs colour
 * wrong here. That is the behaviour this whole module replaces, kept as the floor so a CSP or build
 * regression degrades instead of rendering everything grey.
 */
async function onMainThread(path: string, code: string): Promise<HighlightLines> {
  const lang = langFor(path)
  if (lang === 'text') return plain(code)
  try {
    const hl = await getHighlighter(lang)
    return code
      .split('\n')
      .map((line) =>
        (hl.codeToTokensWithThemes(line, { lang: lang as never, themes: { light: 'github-light', dark: 'github-dark' } })[0] ?? []).map((t) => ({
          content: t.content,
          light: t.variants.light.color ?? '',
          dark: t.variants.dark.color ?? '',
        })),
      )
  } catch {
    return plain(code)
  }
}

/** A document's lines, and whether they are the main thread's stand-in for a worker that did not
 *  answer in time. A timeout can pass, so a caller that keeps the colour should not keep that one as
 *  if it were final. Every other fallback lasts: a dead worker stays dead, and a grammar error
 *  repeats on the same code. */
export type HighlightResult = { lines: HighlightLines; timedOut: boolean }

/** As `tokenizeDocument`, saying whether a timeout decided the result. Never rejects. */
export async function highlightDocument(path: string, code: string): Promise<HighlightResult> {
  const lang = langFor(path)
  if (lang === 'text') return { lines: plain(code), timedOut: false }
  recordSample('core', 'highlight.characters', code.length)
  const fallback = async (reason: string): Promise<HighlightResult> => {
    recordSample('core', 'highlight.fallback', 1, '1', { reason })
    const lines = await measure('core', 'highlight.main_thread', () => onMainThread(path, code))
    return { lines, timedOut: reason === 'timeout' }
  }
  const result = await owner.request((id) => ({
    id, lang, code, ...(telemetryEnabled() ? { sentAt: performance.timeOrigin + performance.now() } : {}),
  }))
  if (result.kind === 'degraded') {
    recordSample('core', 'highlight.fallback', 1, '1', { reason: 'retired' })
    return { lines: plain(code), timedOut: true }
  }
  if (result.kind === 'fallback') return fallback('unavailable')
  const lines = result.value
  if (lines.length === 0 && code.length > 0) return fallback('empty-result')
  recordSample('core', 'highlight.lines', lines.length)
  return { lines, timedOut: false }
}

/** Tests only: settle and retire this generation before trying a fresh worker. */
export const resetHighlightWorker = owner.reset

registerPageFact('ui.page.workers.highlight', owner.workerCount)

export const tokenizeDocument: TokenizeDocument = async (path, code) => (await highlightDocument(path, code)).lines
