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
   *
   * `thumb` is `inline` drawn as a short band across whatever holds it, cropped to fill, for a picture
   * that stands for a file rather than being the content: an attachment above its filename, where full
   * size would push everything else off the card. The flavour is the whole difference, so it rides the
   * same `<img>` and the stylesheet does the sizing.
   */
  images?: 'inline' | 'placeholder' | 'thumb'
}

// Sentinel wrapping protected inline-token indexes. A private-use char esc() ignores, so tokens
// survive escaping and subsequent Markdown transforms can't mutate them.
//
// The input decides what is in it, so "real text never contains this" is a wish rather than a fact.
// A source that spelled the sentinel itself used to forge an index into the `codes` and `images`
// arrays and reach an entry that was never put there, and the restore then read `.alt` or `.replace`
// off undefined and threw. renderMarkdown strips the character on the way in, once, which kills the
// class rather than the two probes that found it: after the strip there is no way to write a sentinel
// that inline() did not write itself.
const S = '\uE000'

// Inline pass on raw text: protect code spans and images, escape, then apply links / bold / italic.
function inline(raw: string, opts: MarkdownOptions): string {
  const codes: string[] = []
  const images: { alt: string; url: string }[] = []
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => `${S}${codes.push(c) - 1}${S}`)
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt: string, url: string) =>
    `${S}i${images.push({ alt, url }) - 1}${S}`)
  s = esc(s)
  // A rendered link parks its href here and leaves a sentinel in its place, so the autolink pass
  // below cannot see a URL it has already handled. Only the href hides: the link's text stays in the
  // string, so emphasis written inside it still renders.
  const hrefs: string[] = []
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url) // url is already escaped, so don't re-escape it
    return href ? `<a href="${S}l${hrefs.push(href) - 1}${S}" target="_blank" rel="noreferrer">${text}</a>` : text
  })
  // A pasted URL is a link too. Nobody writing in a note or a commit message reaches for the bracket
  // form, and a model writes one far less often than it writes the bare address, so without this the
  // most common link in the app is the one you cannot click. Trailing punctuation is left out of the
  // match because a sentence ends with a full stop more often than a URL does.
  s = s.replace(/https?:\/\/[^\s<\uE000]*[^\s<\uE000.,:;!?)\]}'"]/g, (url: string) =>
    `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
  s = s.replace(new RegExp(`${S}l(\\d+)${S}`, 'g'), (_m, i: string) => hrefs[Number(i)])
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

/** One rendered block, with a key that changes only when the block's own source does. */
export type MarkdownBlock = { key: string; html: string }

// FNV-1a, 32 bits, carried in the key beside the block's length. A block only has to be told apart
// from its own previous version and from its neighbours, and this is cheap enough to run over a whole
// message on every streamed frame — which is the point: a streaming message re-parses its last block
// and reuses the elements of every block before it (ui Markdown.tsx).
const digest = (text: string): string => {
  let h = 0x811c9dc5
  for (let at = 0; at < text.length; at++) {
    h ^= text.charCodeAt(at)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * The same render as `renderMarkdown`, block by block, so a caller that re-renders often can keep the
 * elements whose source has not moved. Appending a character to a message changes exactly one key: the
 * trailing block's.
 */
export function renderBlocks(src: string, opts: MarkdownOptions = {}): MarkdownBlock[] {
  // Strip the sentinel before anything reads the source. See `S` above; this is the whole defence,
  // and it belongs at the one entry point rather than at each of the six `inline()` call sites.
  const lines = src.replaceAll(S, '').replace(/\r\n?/g, '\n').split('\n')
  const out: MarkdownBlock[] = []
  // The image policy is in the key because it decides the html: two Markdown surfaces sharing a
  // highlight cache must not share a block.
  const flavour = opts.images ?? 'inline'
  let i = 0
  const emit = (html: string, from: number): void => {
    const source = lines.slice(from, i).join('\n')
    out.push({ key: `${flavour}:${source.length}:${digest(source)}`, html })
  }
  while (i < lines.length) {
    const start = i
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
      emit(`<div class="ui-code-wrap"><pre><code data-language="${esc(lang)}">${esc(buf.join('\n'))}</code></pre></div>`, start)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const n = h[1].length
      i++
      emit(`<h${n}>${inline(h[2], opts)}</h${n}>`, start)
      continue
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      i++
      emit('<hr>', start)
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
      emit(
        '<div class="ui-table-scroll" data-scroll><table class="ui-table">'
        + `<thead>${row('th', head)}</thead>`
        + `<tbody>${body.map((r) => row('td', r)).join('')}</tbody>`
        + '</table></div>',
        start,
      )
      continue
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      emit(`<blockquote>${inline(buf.join('\n'), opts).replace(/\n/g, '<br>')}</blockquote>`, start)
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
      const tag = ordered ? 'ol' : 'ul'
      emit(`<${tag}>${items.map((it) => `<li>${inline(it, opts)}</li>`).join('')}</${tag}>`, start)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i]) && !startsTable(lines, i)) buf.push(lines[i++])
    emit(`<p>${inline(buf.join('\n'), opts).replace(/\n/g, '<br>')}</p>`, start)
  }
  return out
}

/** Markdown source to sanitized HTML, as one string. */
export const renderMarkdown = (src: string, opts: MarkdownOptions = {}): string =>
  renderBlocks(src, opts).map((block) => block.html).join('\n')
