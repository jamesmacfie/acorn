import { createEffect, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { isGrammar, langFor } from '../../infra/highlight/langs'
import { renderMarkdown, type MarkdownOptions } from '../lib/markdown'
import CopyButton from './CopyButton'

// Markdown source to rendered DOM: the sanitizing pass in ui/markdown.ts, then a Shiki
// grammar per fence and a copy button on each one. Everything a call site would otherwise repeat.
//
// The `.ui-markdown` class stays available on its own for the call sites that have HTML already,
// either from a provider that renders its own (GitHub hands back `bodyHTML`) or because they need a
// `ref` on the element, which a component cannot offer: a props member named `ref` is a Solid DOM
// setter rather than data.

/** A fence's language hint to a Shiki grammar. `ts` and `typescript` both have to land. */
const grammarFor = (hint: string): string | null => {
  if (isGrammar(hint)) return hint
  const byExtension = langFor(`f.${hint}`)
  return byExtension === 'text' ? null : byExtension
}

export default function Markdown(props: {
  text: string
  /** See MarkdownOptions: `placeholder` for model output, which must not fetch a remote image. */
  images?: MarkdownOptions['images']
  /** A copy button on every fenced block. */
  copy?: boolean
  /** Sandboxed frames have no `navigator.clipboard`, so they pass their bridge's copy here. */
  onCopy?: (text: string) => void
  onClick?: (event: MouseEvent) => void
  /**
   * A link inside the rendered content was clicked, by its href. The browser's own navigation is
   * cancelled, so the handler owns where it goes.
   *
   * One of the kit's eleven events, and that is the point: `onClick` hands over a DOM event, which a
   * remote tree cannot receive and a terminal host does not have. A plugin that re-points itself when
   * one of its own tickets is linked needs this and nothing more.
   */
  onSelect?: (href: string) => void
}) {
  let root: HTMLDivElement | undefined
  let generation = 0
  let rendered: string | undefined
  let disposers: (() => void)[] = []

  const clearButtons = () => {
    for (const dispose of disposers) dispose()
    disposers = []
  }
  onCleanup(() => {
    generation++
    clearButtons()
  })

  createEffect(() => {
    const text = props.text
    // A prop is a getter, not a memo, so this effect re-runs whenever anything upstream ticks, even
    // when the text is identical. Assigning innerHTML replaces every text node underneath, which throws
    // away the reader's selection, so compare before writing.
    if (!root || text === rendered) return
    rendered = text
    const current = ++generation
    clearButtons()
    root.innerHTML = renderMarkdown(text, { images: props.images })

    const wraps = [...root.querySelectorAll<HTMLElement>('.ui-code-wrap')]
    if (props.copy) {
      for (const wrap of wraps) {
        // Per block rather than on the root, so hovering one fence does not light up every button in
        // the document (styles/copy.css keys the reveal off a `.copyable` ancestor).
        wrap.classList.add('copyable')
        // The accessor re-queries rather than closing over the element, because the highlight pass
        // below replaces the `<pre>` it would have captured.
        const codeText = () => wrap.querySelector('code')?.textContent ?? ''
        disposers.push(render(() => <CopyButton text={codeText} onCopy={props.onCopy} />, wrap))
      }
    }

    // Grammars load on demand (highlight/langs.ts), so each fence has to ask for its own before
    // `codeToHtml` can route to it. The highlighter starts with none loaded, and the import is dynamic
    // so a plugin frame that renders a ticket description does not carry the engine for one it never
    // shows.
    const fences = wraps
      .map((wrap) => ({ code: wrap.querySelector<HTMLElement>('pre > code[data-language]'), wrap }))
      .flatMap(({ code, wrap }) => {
        const grammar = code && grammarFor(code.dataset.language ?? 'text')
        return grammar ? [{ code, grammar, wrap }] : []
      })
    if (!fences.length) return
    void (async () => {
      const { getHighlighter } = await import('../../infra/highlight/shiki')
      const highlighter = await getHighlighter()
      await Promise.all([...new Set(fences.map((f) => f.grammar))].map((grammar) => getHighlighter(grammar)))
      if (!root || current !== generation) return
      for (const { code, grammar, wrap } of fences) {
        const html = highlighter.codeToHtml(code.textContent ?? '', {
          lang: grammar,
          themes: { light: 'github-light', dark: 'github-dark' },
        })
        const holder = document.createElement('div')
        holder.innerHTML = html
        const highlighted = holder.firstElementChild
        // Into the wrapper, so the copy button mounted above survives and stays positioned.
        if (highlighted) wrap.querySelector('pre')?.replaceWith(highlighted)
      }
    })()
  })

  return (
    <div
      ref={root}
      class="ui-markdown"
      onClick={(event) => {
        const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
        if (props.onSelect && href) {
          event.preventDefault()
          props.onSelect(href)
        }
        props.onClick?.(event)
      }}
    />
  )
}
