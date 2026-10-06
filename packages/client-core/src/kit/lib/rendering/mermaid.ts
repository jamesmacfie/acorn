// A ```mermaid fence to a diagram, for kit Markdown.tsx. The engine is a dynamic import, so a surface
// only loads it the first time a message holds a diagram, the same way fences load their Shiki grammar.
import { isAppDark, token } from '../../tokens/appearance'

// Mermaid's `strict` level already runs its output through DOMPurify, which stops scripts but not
// fetches. A diagram is model or provider output like any other Markdown, so it gets the same rule as
// a Markdown image (markdown.ts § safeImageSrc): nothing in it may make the client request a URL
// without a click, and nothing in it may navigate the app. A label can hold an `<img>`, a style
// directive can hold `url(https://…)`, and a `click` line can hold a link. Every reference that is not
// to an element inside the diagram itself (`#id`, `url(#id)`) goes.
const FETCHING_ELEMENTS = new Set([
  'audio', 'embed', 'feimage', 'iframe', 'image', 'img', 'link', 'object', 'picture', 'script',
  'source', 'track', 'video',
])
const REFERENCE_ATTRIBUTES = new Set(['action', 'formaction', 'href', 'poster', 'src', 'srcset', 'xlink:href'])
// CSS that could fetch. A backslash is refused outright because a CSS escape spells `url` or
// `@import` in a way no pattern here would recognise. Mermaid's own stylesheet has none of these, so
// only a diagram that wrote one loses its styles.
const FETCHING_CSS = /\\|@import|image-set|url\(\s*(?!['"]?#)/i

/** Mermaid's svg markup, parsed inert and stripped of anything that would fetch or navigate. */
export function scrubDiagram(svg: string): DocumentFragment {
  const parsed = document.createElement('template')
  parsed.innerHTML = svg
  for (const element of [...parsed.content.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase()
    if (FETCHING_ELEMENTS.has(tag) || (tag === 'style' && FETCHING_CSS.test(element.textContent ?? ''))) {
      element.remove()
      continue
    }
    for (const { name, value } of [...element.attributes]) {
      const lower = name.toLowerCase()
      const remoteReference = REFERENCE_ATTRIBUTES.has(lower) && !value.trim().startsWith('#')
      if (lower.startsWith('on') || remoteReference || FETCHING_CSS.test(value)) element.removeAttribute(name)
    }
  }
  return parsed.content
}

let renders = 0

/**
 * One diagram, drawn in the app's current light or dark scheme. Rejects when the source does not
 * parse, so the caller leaves the fence as code.
 */
export async function renderMermaid(source: string): Promise<DocumentFragment> {
  const { default: mermaid } = await import('mermaid')
  // Global config, set before every render because the theme can change between two of them.
  // Mermaid queues renders internally, so two diagrams drawing at once do not interleave.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    theme: isAppDark() ? 'dark' : 'default',
    fontFamily: token('--font-ui') || undefined,
  })
  const { svg } = await mermaid.render(`ui-mermaid-${++renders}`, source)
  const diagram = scrubDiagram(svg)
  // Without a name, the svg is named by its text, and that starts with its stylesheet. A diagram that
  // set `accTitle` already points `aria-labelledby` at it.
  const root = diagram.querySelector('svg')
  if (root && !root.hasAttribute('aria-labelledby')) root.setAttribute('aria-label', 'Diagram')
  return diagram
}
