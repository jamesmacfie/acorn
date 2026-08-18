// The main-thread half of the highlight worker: one worker, lazily spawned, requests matched to
// replies by id.
//
// WHY DOCUMENTS AND NOT LINES. The obvious port of the old per-line tokenizer is a postMessage per
// line, and it is a trap: one 45-file diff is ~2,600 lines, so that is 2,600 round trips and it is far
// slower than the main-thread code it replaces. Every caller here sends a WHOLE DOCUMENT — for a diff,
// one side of one hunk (ui/diff/model.ts § buildDiffRowsAsync). Batching is not an optimisation on top
// of the worker, it is the thing that makes a worker worth having.
import { getHighlighter } from './shiki'
import { langFor } from './langs'
import type { HighlightLines, HighlightRequest, HighlightResponse } from './protocol'

/** Tokenize a whole document. `path` only picks the grammar; `code` is newline-separated source. */
export type TokenizeDocument = (path: string, code: string) => Promise<HighlightLines>

const plain = (code: string): HighlightLines => code.split('\n').map((line) => [{ content: line, light: '', dark: '' }])

// Generous, because it is a backstop and not a budget: the slowest real document measured was ~110ms,
// and the first request of a session also pays for spawning the worker and instantiating the WASM
// engine (~340ms end to end). Anything past this is stuck, not slow.
const TOKENIZE_TIMEOUT_MS = 10_000

type Pending = { resolve: (lines: HighlightLines) => void }

// 'cold' → nothing tried yet. 'live' → spawned and answering. 'dead' → unavailable or it failed its
// first request; every later call goes straight to the fallback without re-trying, because the two
// ways this fails (no Worker in the environment, CSP not applied to the worker script) are both
// permanent for the life of the window.
let state: 'cold' | 'live' | 'dead' = 'cold'
let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, Pending>()

const failAll = () => {
  for (const [, p] of pending) p.resolve([])
  pending.clear()
}

const kill = (why: string) => {
  if (state !== 'dead') {
    // LOUD, and deliberately so. The failure this replaces was silent for months: the WASM engine's
    // rejection landed inside the highlighter's own promise and every surface simply rendered grey.
    // If the worker is not carrying the load, that is a build or CSP regression someone must see.
    console.error(`[highlight] worker unavailable, falling back to the main thread: ${why}`)
  }
  state = 'dead'
  worker?.terminate()
  worker = null
  failAll()
}

async function spawn(): Promise<Worker | null> {
  if (state === 'dead') return null
  if (worker) return worker
  // No Worker at all: a node-environment test, which is all of them (docs § vitest runs in node).
  if (typeof Worker === 'undefined') {
    state = 'dead'
    return null
  }
  try {
    // Dynamic, not static: a top-level `?worker` import makes this module unloadable in the node test
    // environment, and this module sits under the diff model that several plugin tests do load.
    const { default: HighlightWorker } = await import('./highlighter.worker?worker')
    const spawned = new HighlightWorker()
    spawned.onmessage = (event: MessageEvent<HighlightResponse>) => {
      const message = event.data
      const entry = pending.get(message.id)
      if (!entry) return
      pending.delete(message.id)
      if (message.ok) {
        state = 'live'
        entry.resolve(message.lines)
        return
      }
      // A per-document failure (bad grammar, rejected pattern) is not a dead worker — resolve this one
      // empty and let the caller fall back for that document only.
      entry.resolve([])
    }
    spawned.onerror = () => kill('worker script failed to load or run')
    worker = spawned
    return spawned
  } catch (error) {
    kill(String((error as Error)?.message ?? error))
    return null
  }
}

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
  const w = await spawn()
  if (!w) return onMainThread(path, code)
  const id = nextId++
  const request: HighlightRequest = { id, lang, code }
  const lines = await new Promise<HighlightLines>((resolve) => {
    // A TextMate grammar is a regex program, and a regex program can backtrack catastrophically. The
    // worker cannot block the UI, but a request that never comes back would leave a diff file showing
    // its loading row forever — so give up on it and let the caller render plain text instead.
    const timer = setTimeout(() => {
      pending.delete(id)
      resolve([])
    }, TOKENIZE_TIMEOUT_MS)
    pending.set(id, {
      resolve: (result) => {
        clearTimeout(timer)
        resolve(result)
      },
    })
    w.postMessage(request)
  })
  // Empty means the worker could not do it (see onmessage). Fall back for this document.
  if (lines.length === 0 && code.length > 0) return onMainThread(path, code)
  return lines
}

/** Tests only: forget the worker so the next call re-evaluates the environment. */
export const resetHighlightWorker = () => {
  worker?.terminate()
  worker = null
  state = 'cold'
  pending.clear()
}
