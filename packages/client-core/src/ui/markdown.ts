// Markdown source to sanitized HTML: the string half of the design system's Markdown surface, beside
// ui/Markdown.tsx (the component that renders it) and `.ui-markdown` (the styles it targets). It moved
// here from integrations/, where it started as Linear's ticket-body renderer, once core owned the
// surface. Zero imports of its own, which is what lets ui/ hold it and a sandboxed frame call it
// without pulling the shell across.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c])

// Allow only http(s) and mailto; the input is already HTML-escaped when this runs.
const safeHref = (u: string): string | null => (/^(https?:\/\/|mailto:)/i.test(u) ? u : null)
// Images are fetched by the renderer, so mailto is not meaningful here.
//
// `data:image/` is allowed alongside http(s) because of the sandboxed plugin frames, whose CSP is
// `img-src 'self' data:` with `connect-src 'none'` (docs/shell.md § The plugin frame origin). A frame
// cannot load a remote image at all, and a provider's uploads are usually behind the same credential
// its API is, so the only way one draws a picture is for its node half to fetch the bytes and hand
// them back inline. Inert either way: an `<img>` never executes what it points at, SVG included.
const safeImageSrc = (u: string): boolean => /^(https?:\/\/|data:image\/)/i.test(u)

export type MarkdownOptions = {
  /**
   * What an image in the source becomes. `inline` renders an `<img>`, for content a person wrote in a
   * tracker or a note. `placeholder` renders the alt text and never issues the request, for output a
   * model produced: a remote image there is a tracking pixel that carries the reader's IP, and the
   * managed-agent transcript is provider text rather than authored text. Defaults to `inline`.
   */
  images?: 'inline' | 'placeholder'
}

// Sentinel wrapping protected inline-token indexes. A private-use char esc() ignores and real text
// never contains, so tokens survive escaping and subsequent Markdown transforms can't mutate them.
const S = '\uE000'

// Inline pass on raw text: protect code spans and images, escape, then apply links / bold / italic.
function inline(raw: string, opts: MarkdownOptions): string {
  const codes: string[] = []
  const images: { alt: string; url: string }[] = []
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => `${S}${codes.push(c) - 1}${S}`)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) =>
    `${S}i${images.push({ alt, url }) - 1}${S}`)
  s = esc(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url) // url is already escaped, so don't re-escape it
    return href ? `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>` : text
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
  s = s.replace(new RegExp(`${S}(\\d+)${S}`, 'g'), (_m, i: string) => `<code>${esc(codes[Number(i)])}</code>`)
  s = s.replace(new RegExp(`${S}i(\\d+)${S}`, 'g'), (_m, i: string) => {
    const image = images[Number(i)]
    if (opts.images === 'placeholder') {
      return `<span class="ui-md-omitted">[image: ${esc(image.alt) || 'omitted'}]</span>`
    }
    return safeImageSrc(image.url)
      ? `<img src="${esc(image.url)}" alt="${esc(image.alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
      : esc(image.alt)
  })
  return s
}

const isBlockStart = (l: string) => /^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s+)/.test(l) || /^(---+|\*\*\*+)$/.test(l.trim())

// A row of cells, minus the optional outer pipes. An escaped `\|` is a literal pipe in a cell, which
// is the only way to write one inside a table at all, so the split has to skip it.
const cells = (row: string): string[] =>
  row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'))

// The `|---|---|` line under the header is what separates a table from a paragraph that happens to
// contain a pipe, so a table is only a table when the next line is one.
const isTableSeparator = (l: string | undefined): boolean =>
  !!l && l.includes('|') && l.includes('-') && /^[\s|:-]+$/.test(l)
const startsTable = (lines: string[], i: number): boolean =>
  lines[i].includes('|') && isTableSeparator(lines[i + 1])

export function renderMarkdown(src: string, opts: MarkdownOptions = {}): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const fence = /^```\s*([a-zA-Z0-9_+#-]*)/.exec(line.trim())
    if (fence) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) buf.push(lines[i++])
      i++ // closing fence
      // The language hint travels as an attribute rather than a class because nothing styles it: the
      // Markdown component reads it to pick a Shiki grammar, and a fence with no hint stays plain.
      const lang = fence[1] || 'text'
      out.push(`<div class="ui-code-wrap"><pre><code data-language="${esc(lang)}">${esc(buf.join('\n'))}</code></pre></div>`)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const n = h[1].length
      out.push(`<h${n}>${inline(h[2], opts)}</h${n}>`)
      i++
      continue
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      out.push('<hr>')
      i++
      continue
    }
    if (startsTable(lines, i)) {
      const head = cells(line)
      i += 2 // header and separator
      const body: string[][] = []
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) body.push(cells(lines[i++]))
      // Squared off against the header, the way GitHub does it: a row with a cell too many or too few
      // otherwise shifts every column after it, and a model miscounting pipes is common.
      const row = (tag: string, values: string[]) =>
        `<tr>${head.map((_c, n) => `<${tag}>${inline(values[n] ?? '', opts)}</${tag}>`).join('')}</tr>`
      // The `:---:` alignment markers are parsed off and dropped. Applying one means an inline style
      // attribute, which the plugin frames' CSP refuses, so it needs a data attribute and a rule per
      // alignment. Nothing has asked yet.
      out.push(
        '<div class="ui-table-scroll" data-scroll><table class="ui-table">'
        + `<thead>${row('th', head)}</thead>`
        + `<tbody>${body.map((r) => row('td', r)).join('')}</tbody>`
        + '</table></div>',
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(buf.join('\n'), opts).replace(/\n/g, '<br>')}</blockquote>`)
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it, opts)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i]) && !startsTable(lines, i)) buf.push(lines[i++])
    out.push(`<p>${inline(buf.join('\n'), opts).replace(/\n/g, '<br>')}</p>`)
  }
  return out.join('\n')
}
