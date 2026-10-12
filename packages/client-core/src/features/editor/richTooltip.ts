// The body of an editor tooltip that shows a plugin's content: language hover, and annotation detail
// such as line blame. One sanitizing path for both, so a fix to one reaches the other.
import { EditorView } from '@codemirror/view'
import { renderMarkdown } from '../../kit/lib/rendering/markdown'
import { sanitizedHtmlFragment } from '../../kit/lib/rendering/sanitizedHtml'

export type RichTooltipContent = string | { kind: 'markdown' | 'plaintext'; value: string }

/**
 * A tooltip body for untrusted plugin content, with the host's credit line under it.
 *
 * Markdown is escaped and then sanitized, with every image a placeholder, so a plugin's content can't
 * reach the network or run anything. The host writes the credit, so a plugin can't pass its content
 * off as another plugin's. Style it by adding `richTooltipTheme` to the view.
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

export const richTooltipTheme = EditorView.baseTheme({
  '.cm-document-hover': { maxWidth: '480px', maxHeight: '320px', overflow: 'auto', padding: '6px 8px' },
  '.cm-document-hover-from': { marginTop: '4px', fontSize: '0.85em', opacity: '0.7' },
})
