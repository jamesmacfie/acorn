import { measure, recordDuration, recordSample, telemetryEnabled } from '../telemetry/emitter'
// The main-thread half of the highlight worker: one worker, lazily spawned, requests matched to
// replies by id. See docs/diff-rendering/loading.md § Syntax highlighting for why every caller sends a
// whole document (for a diff, one side of one hunk: see `enrichDiffRows`) rather
// than a line.
import { getHighlighter, renderFenceOnMainThread } from './shiki'
import { langFor } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './messages'
import { createLogger } from '../telemetry/logger'
import { createDocumentWorker } from './documentWorker'
import { registerPageFact } from '../telemetry/pageFacts'

const log = createLogger('highlight')

/** Tokenize a whole document. `path` only picks the grammar; `code` is newline-separated source. */
export type TokenizeDocument = (path: string, code: string) => Promise<HighlightLines>

const plain = (code: string): HighlightLines => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])

const owner = createDocumentWorker<HighlightRequest, HighlightResponse, HighlightLines | string>({
  load: () => import('./highlighter.worker?worker'),
  response: (message) => {
    if (message.queueMs !== undefined) recordDuration('core', 'highlight.queue.wait', message.queueMs)
    if (message.executionMs !== undefined) recordDuration('core', 'highlight.worker.execute', message.executionMs)
    recordSample('core', 'highlight.result', 1, '1', { outcome: message.ok ? 'worker' : 'grammar-error' })
    return message.ok
      ? { kind: 'value', value: 'html' in message ? message.html : message.lines }
      : { kind: 'fallback' }
  },
  unavailable: (reason) => log.error(`worker unavailable, falling back to the main thread: ${reason}`),
  timeout: () => recordSample('core', 'highlight.timeout', 1),
  pending: (count) => recordSample('core', 'highlight.pending', count),
})

/** Epoch timestamp only when diagnostics are on; timeOrigin + now is comparable across workers. */
const sentAt = () => (telemetryEnabled() ? { sentAt: performance.timeOrigin + performance.now() } : {})

/**
 * Tokenize on the main thread. The fallback, not the path: it uses the JavaScript regex engine (the
 * only one the document's CSP permits) and tokenizes line by line, so multi-line constructs colour
 * wrong here. It is the floor, so a CSP or build regression degrades instead of rendering everything
 * grey.
 */
async function onMainThread(path: string, code: string): Promise<HighlightLines> {
  const lang = langFor(path)
  if (lang === 'text') return plain(code)
  try {
    const hl = await getHighlighter(lang)
    return code.split('\n').map((line) =>
      (
        hl.codeToTokensWithThemes(line, {
          lang: lang as never,
          themes: { light: 'github-light', dark: 'github-dark' },
        })[0] ?? []
      ).map((t) => ({
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
  const result = await owner.request((id) => ({ id, lang, code, ...sentAt() }))
  if (result.kind === 'degraded') {
    recordSample('core', 'highlight.fallback', 1, '1', { reason: 'retired' })
    return { lines: plain(code), timedOut: true }
  }
  if (result.kind === 'fallback' || typeof result.value === 'string') return fallback('unavailable')
  const lines = result.value
  if (lines.length === 0 && code.length > 0) return fallback('empty-result')
  recordSample('core', 'highlight.lines', lines.length)
  return { lines, timedOut: false }
}

// A fence's highlighted html, keyed by its language and its exact text. Block reuse in the kit
// `Markdown` already stops an unchanged fence from being re-tokenized while a streaming message is on
// screen; this catches the rest: the same fence coming back after a scroll, a view switch or a
// remount, and the same snippet appearing twice.
//
// Exact keys rather than a hash, because a hash collision would show a reader the wrong code. The
// price is memory, so the window is small and a fence over 16 KB is not kept at all.
const HTML_CACHE_ENTRIES = 200
const HTML_CACHE_MAX_BYTES = 16 * 1024
const htmlCache = new Map<string, string>()
type HtmlFlight = { live: Set<() => boolean>; promise: Promise<string> }
const htmlFlights = new Map<string, HtmlFlight>()

/** The worker's html for a fence, or the main thread's when the worker cannot answer. A worker retired
 *  for a deadline answers '' rather than replaying a slow fence on the renderer. */
async function renderFence(code: string, lang: string, isLive: () => boolean): Promise<string> {
  const result = await owner.request((id) => ({ id, lang, code, output: 'html', ...sentAt() }))
  if (result.kind === 'degraded') {
    recordSample('core', 'highlight.fallback', 1, '1', { reason: 'retired' })
    return ''
  }
  if (result.kind === 'value' && typeof result.value === 'string') return result.value
  recordSample('core', 'highlight.fallback', 1, '1', { reason: 'unavailable' })
  return measure('core', 'highlight.main_thread', () => renderFenceOnMainThread(code, lang, isLive))
}

/**
 * Highlight one whole fence to html, dual-themed. It can reject, because a grammar that will not load
 * fails in the worker and again on the main thread, so a caller catches and renders the fence plain.
 */
export function highlightToHtml(code: string, lang: string, isLive: () => boolean = () => true): Promise<string> {
  const key = `${lang}\u0000${code}`
  const hit = htmlCache.get(key)
  recordSample('core', 'highlight.html.cache', 1, '1', { cache: hit === undefined ? 'miss' : 'hit' })
  if (hit !== undefined) return Promise.resolve(hit)
  const joining = htmlFlights.get(key)
  if (joining) {
    joining.live.add(isLive)
    return joining.promise
  }
  const live = new Set([isLive])
  const flight: HtmlFlight = { live, promise: Promise.resolve('') }
  // Grammar admission is shared. A leaving block cannot cancel another block's highlight.
  const anyLive = () => [...live].some((consumer) => consumer())
  recordSample('core', 'highlight.html.characters', code.length)
  flight.promise = renderFence(code, lang, anyLive)
    .then((html) => {
      if (html && code.length <= HTML_CACHE_MAX_BYTES) {
        if (htmlCache.size >= HTML_CACHE_ENTRIES) {
          const oldest = htmlCache.keys().next()
          if (!oldest.done) htmlCache.delete(oldest.value)
        }
        htmlCache.set(key, html)
      }
      return html
    })
    .finally(() => {
      if (htmlFlights.get(key) === flight) htmlFlights.delete(key)
      live.clear()
    })
  htmlFlights.set(key, flight)
  return flight.promise
}

/** Tests only: forget what has been highlighted so a spy can count calls from a known state. */
export const resetHighlightHtmlCache = (): void => htmlCache.clear()

/** Tests only: settle and retire this generation before trying a fresh worker. */
export const resetHighlightWorker = owner.reset

registerPageFact('ui.page.workers.highlight', owner.workerCount)

export const tokenizeDocument: TokenizeDocument = async (path, code) => (await highlightDocument(path, code)).lines
