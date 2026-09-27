import { createEffect } from 'solid-js'
import { sanitizedHtmlFragment } from '../../lib/sanitizedHtml'

/** Provider-rendered HTML without scripts, active content, or automatic resource loads. */
export default function SanitizedHtml(props: { html: string }) {
  let root: HTMLDivElement | undefined
  let written: string | undefined
  createEffect(() => {
    const html = props.html
    if (!root || html === written) return
    written = html
    root.replaceChildren(sanitizedHtmlFragment(html))
  })
  return <div ref={root} class="ui-markdown" />
}
