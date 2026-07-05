// Minimal, XSS-safe Markdown → HTML for Linear ticket bodies (which arrive as raw markdown,
// unlike GitHub bodies which come pre-sanitized as HTML). Safety invariant: ALL text is HTML-
// escaped before any transform, and links only emit validated http(s)/mailto hrefs — so even
// imperfect parsing can never inject markup. Covers the common subset (headings, bold, italic,
// inline + fenced code, links, lists, blockquotes, rules); not full CommonMark. ponytail: a hand-
// rolled subset beats adding a markdown lib + sanitizer; widen the subset if tickets need it.

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESC[c])

// Allow only http(s) and mailto; the input is already HTML-escaped when this runs.
const safeHref = (u: string): string | null => (/^(https?:\/\/|mailto:)/i.test(u) ? u : null)

// Sentinel wrapping a code-span index. A private-use char esc() ignores and real text never
// contains, so it survives escaping and can't collide with content.
const S = '\uE000'

// Inline pass on RAW text: protect code spans, escape, then apply links / bold / italic.
function inline(raw: string): string {
  const codes: string[] = []
  let s = raw.replace(/`([^`]+)`/g, (_m, c: string) => `${S}${codes.push(c) - 1}${S}`)
  s = esc(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, url: string) => {
    const href = safeHref(url) // url is already escaped, so don't re-escape it
    return href ? `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>` : text
  })
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
  s = s.replace(new RegExp(`${S}(\\d+)${S}`, 'g'), (_m, i: string) => `<code>${esc(codes[Number(i)])}</code>`)
  return s
}

const isBlockStart = (l: string) => /^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s+)/.test(l) || /^(---+|\*\*\*+)$/.test(l.trim())

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line.trim())) {
      const buf: string[] = []
      i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
      i++ // closing fence
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line)
    if (h) {
      const n = h[1].length
      out.push(`<h${n}>${inline(h[2])}</h${n}>`)
      i++
      continue
    }
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      out.push('<hr>')
      i++
      continue
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''))
      out.push(`<blockquote>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</blockquote>`)
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line)
      const items: string[] = []
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
      const tag = ordered ? 'ol' : 'ul'
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (line.trim() === '') {
      i++
      continue
    }
    const buf: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) buf.push(lines[i++])
    out.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }
  return out.join('\n')
}
