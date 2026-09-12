import { measureWork } from '../../lib/workTelemetry'
import { createEffect, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { isGrammar, langFor } from '../../../infra/highlight/langs'
import { renderBlocks, type MarkdownOptions } from '../../lib/markdown'
import CopyButton from '../inputs/CopyButton'

// Markdown source to rendered DOM: the sanitizing pass in kit/lib/markdown.ts, then a Shiki
// grammar per fence and a copy button on each one. Everything a call site would otherwise repeat.
//
// It renders block by block. A streaming agent message arrives about 25 times a second and grows at
// the end, and this component used to answer each of those by replacing the whole subtree: every
// paragraph re-parsed, every copy button disposed and re-mounted, every code fence re-tokenized. A
// message with three fences re-highlighted three blocks 25 times a second while its fourth paragraph
// streamed. Now `renderBlocks` gives each block a key over its own source, this holds the element it
// rendered for each key, and only the trailing open block is replaced.
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

// One rendered block: the element it produced, the copy button mounted inside it, and whether it is
// still the current render's. `live` is what an in-flight highlight checks, rather than a render
// generation: a block that survives three updates while its grammar loads must still get its colour.
type Block = { key: string; el: Element; dispose?: () => void; live: boolean }

export default function Markdown(props: {
  text: string
  /** See MarkdownOptions: `placeholder` for model output, which must not fetch a remote image. */
  images?: MarkdownOptions['images']
  /** A copy button on every fenced block. */
  copy?: boolean
  /** Sandboxed frames have no `navigator.clipboard`, so they pass their bridge's copy here. */
  onCopy?: (text: string) => void
  /**
   * A link inside the rendered content was pressed, by its href. Return `false` to let the link open
   * the way it would have; anything else, `undefined` included, means the handler took it and the
   * browser's own navigation is cancelled.
   *
   * The only event on this node, and the only one it needs: the link's destination is the whole
   * question. There used to be an `onClick` beside it handing over the DOM event, which a remote tree
   * cannot receive and a terminal host does not have; its two callers wanted `openInAppUrl(href)` and
   * the browser on a false, which is what the return value is for. Removed when the terminal host
   * started drawing this node (docs/tui.md).
   */
  onSelect?: (href: string) => boolean | void
}) {
  let root: HTMLDivElement | undefined
  let rendered: string | undefined
  let blocks: Block[] = []

  const drop = (block: Block) => {
    block.live = false
    block.dispose?.()
  }
  onCleanup(() => {
    for (const block of blocks) drop(block)
    blocks = []
  })

  createEffect(() => measureWork('markdown.render', () => {
    const text = props.text
    // A prop is a getter, not a memo, so this effect re-runs whenever anything upstream ticks, even
    // when the text is identical. Rewriting the DOM throws away the reader's selection, so compare
    // before writing — and then, below, write only the blocks that actually moved.
    if (!root || text === rendered) return
    rendered = text
    const next = measureWork('markdown.parse', () => renderBlocks(text, { images: props.images }), { characters: text.length })

    // Elements from the last render, queued per key so two identical blocks in one message each keep
    // an element of their own rather than fighting over the same one.
    const spare = new Map<string, Block[]>()
    for (const block of blocks) {
      const queue = spare.get(block.key)
      if (queue) queue.push(block)
      else spare.set(block.key, [block])
    }

    const fences: { code: HTMLElement; grammar: string; wrap: Element; block: Block }[] = []
    const placed: Block[] = []
    for (const { key, html } of next) {
      const reused = spare.get(key)?.shift()
      if (reused) {
        placed.push(reused)
        continue
      }
      // Every branch of the parser emits exactly one top-level element, so a block is one child of the
      // root and needs no wrapper of its own — the DOM and the stylesheet see what they always did.
      const holder = document.createElement('div')
      holder.innerHTML = html
      const el = holder.firstElementChild
      if (!el) continue
      const block: Block = { key, el, live: true }
      placed.push(block)

      const wraps = [...el.querySelectorAll<HTMLElement>('.ui-code-wrap')]
      if (el.classList.contains('ui-code-wrap')) wraps.unshift(el as HTMLElement)
      if (props.copy) {
        for (const wrap of wraps) {
          // Per block rather than on the root, so hovering one fence does not light up every button in
          // the document (styles/copy.css keys the reveal off a `.copyable` ancestor).
          wrap.classList.add('copyable')
          // The accessor re-queries rather than closing over the element, because the highlight pass
          // below replaces the `<pre>` it would have captured.
          const codeText = () => wrap.querySelector('code')?.textContent ?? ''
          const dispose = render(() => <CopyButton text={codeText} onCopy={props.onCopy} />, wrap)
          const previous = block.dispose
          block.dispose = () => {
            previous?.()
            dispose()
          }
        }
      }
      for (const wrap of wraps) {
        const code = wrap.querySelector<HTMLElement>('pre > code[data-language]')
        const grammar = code && grammarFor(code.dataset.language ?? 'text')
        if (code && grammar) fences.push({ code, grammar, wrap, block })
      }
    }

    // Reconcile in place. In the streaming case every block before the last is already sitting in the
    // right seat, so this touches one child and leaves the rest of the DOM — and any selection inside
    // it — exactly where it was.
    for (let at = 0; at < placed.length; at++) {
      const want = placed[at].el
      if (root.childNodes[at] === want) continue
      root.insertBefore(want, root.childNodes[at] ?? null)
    }
    while (root.childNodes.length > placed.length) root.lastChild?.remove()
    for (const queue of spare.values()) for (const block of queue) drop(block)
    blocks = placed

    if (!fences.length) return
    // Grammars load on demand (highlight/langs.ts), so each fence has to ask for its own before the
    // highlighter can route to it. The import is dynamic so a plugin frame that renders a ticket
    // description does not carry the engine for one it never shows.
    void (async () => {
      const { highlightToHtml } = await import('../../../infra/highlight/shiki')
      // Started together, applied in order: three fences in three languages are three grammar loads,
      // and awaiting them one at a time would make the last one wait for the first two.
      // Caught per fence: a grammar that fails to load leaves that block plain rather than taking the
      // rest of the message's colour with it, and an unhandled rejection here reaches the host.
      const pending = fences.map((fence) =>
        highlightToHtml(fence.code.textContent ?? '', fence.grammar).catch(() => null))
      for (const [at, { wrap, block }] of fences.entries()) {
        const html = await pending[at]
        if (!html || !block.live) continue
        const holder = document.createElement('div')
        holder.innerHTML = html
        const highlighted = holder.firstElementChild
        // Into the wrapper, so the copy button mounted above survives and stays positioned.
        if (highlighted) wrap.querySelector('pre')?.replaceWith(highlighted)
      }
    })()
  }))

  return (
    <div
      ref={root}
      class="ui-markdown"
      onClick={(event) => {
        // A modified click is the reader asking the browser for something — a new tab, a saved
        // target — and no handler here should take it. Same guard the host's own content-link
        // handler keeps.
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        const href = (event.target as HTMLElement | null)?.closest('a')?.getAttribute('href')
        if (!props.onSelect || !href) return
        if (props.onSelect(href) === false) return
        event.preventDefault()
      }}
    />
  )
}
