// Hover and diagnostics from a plugin's routes, drawn by the host's editor
// (docs/editor/document-surface.md § Language smarts). The owner says which routes to ask and what
// its buffer's edit counter is; this file asks, checks the answer, and draws it. No provider code runs
// here, and a provider never sees the editor.
//
// Both owners use it: the document surface with its region's own routes, and Editor with the
// file-language provider the Node resolved. The terminal draws neither and asks through explicit
// commands with the same checks (host/registries/panes/documentServices.ts).
import { StateEffect, type Extension } from '@codemirror/state'
import { EditorView, ViewPlugin, hoverTooltip, type Tooltip, type ViewUpdate } from '@codemirror/view'
import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import {
  LANGUAGE_REQUEST_TOO_LARGE, languageRequestTooLarge, requestDiagnostics, requestHover,
  type CheckedHover, type DocumentServiceRoute, type DocumentServiceRoutes,
} from '../../host/registries/panes/documentServices'
import { renderMarkdown } from '../../kit/lib/rendering/markdown'
import { sanitizedHtmlFragment } from '../../kit/lib/rendering/sanitizedHtml'

export type LanguageServiceSource = {
  nodeId: string
  /** The routes to ask now. Read at request time, so a provider change needs only a refresh. */
  routes: () => DocumentServiceRoutes
  /** The owner's edit counter for this buffer, sent with each request and checked on each answer. */
  revision: () => number | undefined
  /** Why diagnostics aren't running, or null once they are. */
  onUnavailable?: (reason: string | null) => void
}

/** Dispatch to a view after its provider or registration changed: aborts reads and asks again. */
export const refreshLanguageServices = StateEffect.define<null>()

const DIAGNOSTICS_DEBOUNCE_MS = 500

const SEVERITY: Record<string, Diagnostic['severity']> = { error: 'error', warning: 'warning', information: 'info', hint: 'hint' }

// The host credits the plugin, and the provider's own `source` and `code` follow it. A provider can't
// write the credit, so it can't pass its marks off as another tool's.
const credit = (route: DocumentServiceRoute, ...parts: (string | undefined)[]): string => [route.label, ...parts].filter(Boolean).join(' · ')

function hoverDom(hover: CheckedHover | string, route: DocumentServiceRoute): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-document-hover'
  const body = document.createElement('div')
  if (typeof hover === 'string') body.textContent = hover
  // Escaped and then sanitized, with every image a placeholder, so a provider's Markdown can't reach
  // the network or run anything.
  else if (hover.kind === 'markdown') {
    body.className = 'ui-markdown'
    body.append(sanitizedHtmlFragment(renderMarkdown(hover.value, { images: 'placeholder' })))
  } else body.textContent = hover.value
  const from = document.createElement('div')
  from.className = 'cm-document-hover-from'
  from.textContent = `From ${route.label}`
  dom.append(body, from)
  return dom
}

/** What a hover over `pos` draws, or null. Exported for tests, which have no pointer to hover with. */
export function hoverSource(source: LanguageServiceSource): (view: EditorView, pos: number) => Promise<Tooltip | null> {
  let read: AbortController | undefined
  return async (view, pos) => {
    const route = source.routes().hover
    read?.abort()
    if (!route) return null
    const text = view.state.doc.toString()
    if (languageRequestTooLarge(text)) return { pos, above: true, create: () => ({ dom: hoverDom(LANGUAGE_REQUEST_TOO_LARGE, route) }) }
    const revision = source.revision()
    if (revision === undefined) return null
    const current = read = new AbortController()
    const checked = await requestHover(route.route, source.nodeId, { text, revision, offset: pos }, current.signal)
    if (!checked || current.signal.aborted || source.revision() !== revision) return null
    return { pos: checked.from ?? pos, ...(checked.to !== undefined ? { end: checked.to } : {}), above: true, create: () => ({ dom: hoverDom(checked, route) }) }
  }
}

function diagnostics(source: LanguageServiceSource): Extension {
  return ViewPlugin.fromClass(class {
    timer: ReturnType<typeof setTimeout> | undefined
    read: AbortController | undefined
    destroyed = false
    // A new view, or a pooled state put back on screen, asks at once, so marks never outlive a
    // provider that went away while the file was in the background.
    constructor(readonly view: EditorView) { this.schedule(0) }

    update(update: ViewUpdate): void {
      const refreshed = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(refreshLanguageServices)))
      if (update.docChanged || refreshed) this.schedule(refreshed ? 0 : DIAGNOSTICS_DEBOUNCE_MS)
    }

    destroy(): void {
      this.destroyed = true
      clearTimeout(this.timer)
      this.read?.abort()
    }

    schedule(delay: number): void {
      clearTimeout(this.timer)
      this.read?.abort()
      this.timer = setTimeout(() => void this.run(), delay)
    }

    // Empty, failed, and refused answers all clear this provider's marks. Nothing else in the editor
    // is touched: completion, saving, the selection, and other marks are separate state.
    show(items: Diagnostic[]): void {
      if (!this.destroyed) this.view.dispatch(setDiagnostics(this.view.state, items))
    }

    async run(): Promise<void> {
      const route = source.routes().diagnostics
      const text = this.view.state.doc.toString()
      const tooLarge = !!route && languageRequestTooLarge(text)
      source.onUnavailable?.(tooLarge ? LANGUAGE_REQUEST_TOO_LARGE : null)
      const revision = source.revision()
      if (!route || tooLarge || revision === undefined) return this.show([])
      const read = this.read = new AbortController()
      const items = await requestDiagnostics(route.route, source.nodeId, { text, revision }, read.signal)
      if (read.signal.aborted || this.destroyed || source.revision() !== revision) return
      this.show((items ?? []).map((item) => ({
        from: item.from, to: item.to, severity: SEVERITY[item.severity] ?? 'info', message: item.message,
        source: credit(route, item.source, item.code),
      })))
    }
  })
}

const languageServiceTheme = EditorView.baseTheme({
  '.cm-document-hover': { maxWidth: '480px', maxHeight: '320px', overflow: 'auto', padding: '6px 8px' },
  '.cm-document-hover-from': { marginTop: '4px', fontSize: '0.85em', opacity: '0.7' },
})

/** Hover and diagnostics for one editor state. Asks nothing while `routes()` names neither. */
export const languageServices = (source: LanguageServiceSource): Extension =>
  [hoverTooltip(hoverSource(source)), diagnostics(source), languageServiceTheme]
