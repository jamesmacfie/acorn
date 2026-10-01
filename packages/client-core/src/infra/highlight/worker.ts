import { measure, recordDuration, recordSample, telemetryEnabled } from '../telemetry/emitter'
// The main-thread half of the highlight worker: one worker, lazily spawned, requests matched to
// replies by id. See docs/diff-rendering.md § Syntax highlighting for why every caller sends a
// whole document (for a diff, one side of one hunk: ui/diff/model.ts § buildDiffRowsAsync) rather
// than a line.
import { getHighlighter } from './shiki'
import { langFor } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './messages'
import { createLogger } from '../telemetry/logger'
import { createDocumentWorker } from './documentWorker'

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

/** Never rejects. A highlighter that degrades beats one that takes its surface down. */
export const tokenizeDocument: TokenizeDocument = async (path, code) => {
  const lang = langFor(path)
  if (lang === 'text') return plain(code)
  recordSample('core', 'highlight.characters', code.length)
  const fallback = (reason: string) => {
    recordSample('core', 'highlight.fallback', 1, '1', { reason })
    return measure('core', 'highlight.main_thread', () => onMainThread(path, code))
  }
  const result = await owner.request((id) => ({
    id, lang, code, ...(telemetryEnabled() ? { sentAt: performance.timeOrigin + performance.now() } : {}),
  }))
  if (result.kind === 'degraded') {
    recordSample('core', 'highlight.fallback', 1, '1', { reason: 'retired' })
    return plain(code)
  }
  if (result.kind === 'fallback') return fallback('unavailable')
  const lines = result.value
  if (lines.length === 0 && code.length > 0) return fallback('empty-result')
  recordSample('core', 'highlight.lines', lines.length)
  return lines
}

/** Tests only: settle and retire this generation before trying a fresh worker. */
export const resetHighlightWorker = owner.reset
