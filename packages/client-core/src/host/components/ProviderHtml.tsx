import { createEffect } from 'solid-js'
import { linkifyRefs } from '../registries/panes/contentLinks'
import { sanitizedHtmlFragment } from '../../kit/lib/rendering/sanitizedHtml'

// HTML a provider already rendered, drawn in the host's markdown skin.
//
// GitHub hands back `bodyHTML` rather than markdown source, and so do most trackers, so the kit's
// `Markdown` node has nothing to do with this content: it takes source and sanitises it. What these
// call sites need instead is the same skin, the same bare-reference pass, and the same click
// handling. That pass is host machinery — `linkifyRefs` lives in a registry and `ui/` may not import
// one (docs/frontend/registries.md § Registries and plugins) — which is why this is here and not in the kit.
//
// Provider-rendered HTML is still untrusted. The kit copies only safe formatting and HTTPS links
// into fresh nodes before this host-owned reference pass sees the DOM.

export default function ProviderHtml(props: {
  html: string
  /** Bare-token prefixes this surface has witnessed (`learnRefPrefixes`). The tokens sit in text
   *  nodes the framework never sees, so the pass runs over the written DOM rather than the string. */
  refs?: ReadonlyMap<string, string>
  /** A click inside the content. The host resolves where a link goes; see
   *  registries/contentLinks.ts § handlePluginContentLinkClick. */
  onLinkClick?: (event: MouseEvent) => void
  /** The rendered text, after every write, for a copy control the caller draws elsewhere. Reported
   *  upward rather than read downward, so no caller holds this element. */
  onText?: (text: string) => void
}) {
  let root: HTMLDivElement | undefined
  // Replacing the subtree throws away every text node underneath, which throws away the reader's
  // selection, and a prop is a getter rather than a memo, so this effect re-runs whenever anything
  // upstream ticks. Compare before writing (ui/Markdown.tsx has the same guard for the same reason).
  let written: string | undefined

  createEffect(() => {
    const html = props.html
    const refs = props.refs
    if (!root) return
    if (html !== written) {
      written = html
      root.replaceChildren(sanitizedHtmlFragment(html))
    }
    // Idempotent: the pass never descends into an anchor, so a re-run over already-linked content
    // finds nothing left to do.
    if (refs?.size) linkifyRefs(root, refs)
    props.onText?.(root.textContent ?? '')
  })

  return <div ref={root} class="ui-markdown" onClick={(event) => props.onLinkClick?.(event)} />
}
