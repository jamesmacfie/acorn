// The body of a tooltip that shows a plugin's content: language hover, and annotation detail such as
// line blame or a session mark's reasons. One sanitizing path for all of them, so a fix to one reaches
// the others. Free of CodeMirror, so a surface that isn't an editor can draw it too.
import { renderMarkdown } from './markdown'
import { sanitizedHtmlFragment } from './sanitizedHtml'

export type RichTooltipContent = string | { kind: 'markdown' | 'plaintext'; value: string }

/**
 * A tooltip body for untrusted plugin content, with the host's credit line under it.
 *
 * Markdown is escaped and then sanitized, with every image a placeholder, so a plugin's content can't
 * reach the network or run anything. The host writes the credit, so a plugin can't pass its content
 * off as another plugin's. In an editor, style it by adding `richTooltipTheme` to the view.
 */
export function richTooltipDom(content: RichTooltipContent, credit: string): HTMLElement {
  const dom = document.createElement('div')
  dom.className = 'cm-document-hover'
  const body = document.createElement('div')
  if (typeof content === 'string') body.textContent = content
  else if (content.kind === 'markdown') {
    body.className = 'ui-markdown'
    body.append(sanitizedHtmlFragment(renderMarkdown(content.value, { images: 'placeholder' })))
  } else body.textContent = content.value
  const from = document.createElement('div')
  from.className = 'cm-document-hover-from'
  from.textContent = `From ${credit}`
  dom.append(body, from)
  return dom
}
