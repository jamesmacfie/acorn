import { decodeHTML } from 'entities'
import { renderMarkdown } from '@acorn/client-core/kit/lib/markdown.ts'
import type { TextRole, Tone } from '@acorn/client-core/kit/tokens/tokens.ts'

// Markdown in cells, through the shell's own policy.
//
// `renderMarkdown` decides what markdown means: which links are safe, what a fence is, when a run of
// pipes is a table, and what happens to an image. That decision must not exist twice — a terminal
// that read the source itself would drift from the DOM on the first edge case somebody reports. So
// the source goes through the policy and comes back as HTML, and this file turns that HTML into runs
// of styled text. Sanitised HTML from a generator we own is a small, closed tag set; a general HTML
// parser is not what this is.
//
// Images are asked for as `placeholder`, which is the policy's own way of saying "do not fetch this",
// and in cells there is nothing to fetch with.

export type Run = { text: string; role?: TextRole; tone?: Tone }
export type Line = { runs: Run[]; indent?: number; rule?: true }

const TAG = /<\/?([a-z0-9-]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/gi
const attr = (raw: string, name: string): string | undefined =>
  new RegExp(`${name}="([^"]*)"`).exec(raw)?.[1]

/** The shell's markdown, as lines of runs. Headings bold, lists as `•`, code as its own block,
 *  links as their text with the URL beside them, images gone. */
export const markdownLines = (source: string): Line[] =>
  htmlLines(renderMarkdown(source, { images: 'placeholder' }))

/** The same pass, over HTML somebody else rendered.
 *
 *  GitHub and most trackers hand back `bodyHTML` rather than source, so the policy above has nothing
 *  to decide about them and the skin is the only thing they share with markdown. The DOM host writes
 *  that string into a div (`ProviderHtml`); here it goes through the same tag walk, which is why the
 *  walk is its own function rather than the back half of the one above. */
export function htmlLines(html: string): Line[] {
  const lines: Line[] = []
  let runs: Run[] = []
  let indent = 0
  let role: TextRole | undefined
  let tone: Tone | undefined
  let inCode = false
  let at = 0

  const flush = () => {
    if (runs.length) lines.push(indent ? { runs, indent } : { runs })
    runs = []
  }
  const push = (text: string) => {
    if (text) runs.push({ text, ...(role ? { role } : {}), ...(tone ? { tone } : {}) })
  }

  TAG.lastIndex = 0
  for (let tag = TAG.exec(html); tag; tag = TAG.exec(html)) {
    const between = html.slice(at, tag.index)
    at = tag.index + tag[0].length
    if (between) {
      // Inside a fence the newlines are the author's; everywhere else they are the generator's
      // formatting and a line break belongs to a block tag.
      const text = decodeHTML(between)
      if (inCode) {
        const parts = text.split('\n')
        parts.forEach((part, index) => {
          if (index) flush()
          push(part)
        })
      } else push(text.replace(/\n/g, ' '))
    }
    const name = tag[1].toLowerCase()
    const closing = tag[0].startsWith('</')
    switch (name) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        flush()
        role = closing ? undefined : 'strong'
        break
      case 'p': case 'div': case 'tr': case 'table': case 'thead': case 'tbody':
        flush()
        break
      case 'li':
        flush()
        if (!closing) push('• ')
        break
      case 'ul': case 'ol':
        flush()
        indent = closing ? Math.max(0, indent - 2) : indent + 2
        break
      case 'blockquote':
        flush()
        role = closing ? undefined : 'muted'
        if (!closing) push('│ ')
        break
      case 'pre':
        flush()
        inCode = !closing
        role = closing ? undefined : 'mono'
        lines.push({ runs: [], rule: true })
        break
      case 'code':
        if (!inCode) role = closing ? undefined : 'mono'
        break
      case 'strong': case 'b':
        role = closing ? undefined : 'strong'
        break
      case 'em': case 'i':
        role = closing ? undefined : 'muted'
        break
      case 'a':
        // The URL goes beside the text rather than under it: a terminal has nothing to click, and a
        // link whose target is invisible is worse than one that is two words longer. Appended on the
        // closing tag, so it lands after the words it belongs to.
        tone = closing ? undefined : 'accent'
        break
      case 'br':
        flush()
        break
      case 'hr':
        flush()
        lines.push({ runs: [], rule: true })
        break
      case 'th': case 'td':
        if (!closing && runs.length) push(' │ ')
        break
      case 'img':
        // The policy already replaced an image with its alt text under `placeholder`, so an `<img>`
        // here is one it let through for a host that can draw pictures. This one cannot.
        break
      default:
        break
    }
    // The href, appended after the link's own text so it reads as an aside.
    if (name === 'a' && closing) {
      const opened = html.slice(0, tag.index).lastIndexOf('<a ')
      const href = opened >= 0 ? attr(html.slice(opened, tag.index), 'href') : undefined
      if (href) runs.push({ text: ` (${href})`, role: 'muted' })
    }
  }
  const tail = decodeHTML(html.slice(at))
  if (tail.trim()) push(tail.replace(/\n/g, ' '))
  flush()
  return lines
}
