// Provider HTML is untrusted even when an upstream API says it has sanitized it. Parse it in an
// inert template, then copy only text and known formatting tags into new nodes. Parsed nodes and
// their attributes never enter the live document.
const FORMATTING_TAGS = new Set([
  'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'kbd', 'li', 'ol', 'p', 'pre', 's', 'samp', 'span', 'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul',
])

// These can execute, navigate, fetch, change document parsing, or conceal content. Drop their
// descendants too; unrecognised ordinary HTML elements instead keep their text/formatting children.
const DROP_SUBTREE = new Set([
  'audio', 'base', 'button', 'canvas', 'embed', 'fieldset', 'form', 'frame', 'frameset',
  'iframe', 'img', 'input', 'link', 'math', 'meta', 'noembed', 'noscript', 'object',
  'option', 'picture', 'plaintext', 'portal', 'script', 'select', 'source', 'style',
  'svg', 'template', 'textarea', 'track', 'video', 'xmp',
])

// GitHub draws a "Suggested change" block as a table of removed and added lines, and only its classes
// say which row is which. We read those few tokens and write our own class names in their place, so
// the provider's class string never reaches the page and the skin in primitives.css stays ours.
//
// The `pl-*` tokens are GitHub's syntax highlighting inside that code. We keep the ones that carry a
// colour in GitHub's own stylesheet. The rest (punctuation, markdown emphasis) draw as plain text.
// GitHub also colours by nesting: an identifier inside a template string goes back to plain text,
// where ours keeps the string colour. Map the pair if that ever reads wrong.
const PROVIDER_CLASSES = new Map([
  ['js-suggested-changes-blob', 'ui-md-suggestion'],
  ['blob-num', 'ui-md-suggestion-gutter'],
  ['blob-num-deletion', 'ui-md-suggestion-del'],
  ['blob-code-deletion', 'ui-md-suggestion-del'],
  ['blob-num-addition', 'ui-md-suggestion-add'],
  ['blob-code-addition', 'ui-md-suggestion-add'],
  ['x', 'ui-md-suggestion-word'],
  ['pl-c', 'ui-md-syn-comment'],
  ['pl-k', 'ui-md-syn-keyword'],
  ['pl-s', 'ui-md-syn-string'],
  ['pl-pds', 'ui-md-syn-string'],
  ['pl-sr', 'ui-md-syn-string'],
  ['pl-corl', 'ui-md-syn-string'],
  ['pl-c1', 'ui-md-syn-constant'],
  ['pl-e', 'ui-md-syn-entity'],
  ['pl-en', 'ui-md-syn-entity'],
  ['pl-v', 'ui-md-syn-variable'],
  ['pl-smw', 'ui-md-syn-variable'],
  ['pl-ent', 'ui-md-syn-tag'],
])

const MAX_HTML_LENGTH = 1_000_000
const MAX_NODES = 20_000
const MAX_DEPTH = 64

function safeHref(raw: string | null): string | null {
  // URL() accepts and strips some controls. Refuse them before parsing, along with relative links,
  // encoded/obfuscated schemes and credentials. Only a user click may open the resulting URL.
  if (!raw || !/^https:\/\//i.test(raw) || /[\u0000-\u0020\u007f]/.test(raw)) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

/** Fresh inert markup for provider-rendered descriptions and diff comments. */
export function sanitizedHtmlFragment(html: string): DocumentFragment {
  const safe = document.createDocumentFragment()
  if (html.length > MAX_HTML_LENGTH) {
    safe.append('[HTML content exceeds display limit]')
    return safe
  }

  const parsed = document.createElement('template')
  parsed.innerHTML = html
  let nodes = 0
  let exceeded = false

  const copy = (source: Node, target: Node, depth: number): void => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
      exceeded = true
      return
    }
    if (source.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(source.textContent ?? ''))
      return
    }
    if (source.nodeType !== Node.ELEMENT_NODE) return
    const element = source as Element
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml') return
    const tag = element.localName
    if (DROP_SUBTREE.has(tag)) return

    const allowed = FORMATTING_TAGS.has(tag)
    const href = tag === 'a' ? safeHref(element.getAttribute('href')) : null
    const output = allowed && (tag !== 'a' || href)
      ? document.createElement(tag)
      : target
    if (href && output !== target) {
      const anchor = output as HTMLAnchorElement
      anchor.href = href
      anchor.target = '_blank'
      anchor.rel = 'noopener noreferrer'
    }
    if (output !== target) {
      for (const token of element.classList) {
        const mapped = PROVIDER_CLASSES.get(token)
        if (mapped) (output as Element).classList.add(mapped)
      }
    }
    for (const child of element.childNodes) {
      if (exceeded) break
      copy(child, output, depth + 1)
    }
    if (output !== target) target.appendChild(output)
  }

  for (const child of parsed.content.childNodes) {
    if (exceeded) break
    copy(child, safe, 0)
  }
  if (exceeded) {
    safe.replaceChildren('[HTML content exceeds display limit]')
  }
  return safe
}
