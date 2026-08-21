// Managed-agent Markdown is stricter than integration Markdown: provider output is untrusted, raw HTML is
// escaped, remote images never load, and only explicit http(s)/mailto links become anchors. Fenced code
// carries a validated language hint for the owned Shiki renderer.
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ESCAPES[character])

const safeHref = (value: string): string | null =>
  /^(https?:\/\/|mailto:)/i.test(value) ? value : null

const SENTINEL = '\uE100'

function inline(raw: string): string {
  const code: string[] = []
  const images: string[] = []
  let value = raw.replace(/`([^`]+)`/g, (_match, content: string) =>
    `${SENTINEL}c${code.push(content) - 1}${SENTINEL}`)
  value = value.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_match, alt: string) =>
    `${SENTINEL}i${images.push(alt) - 1}${SENTINEL}`)
  value = escapeHtml(value)
  value = value.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    const href = safeHref(url)
    return href
      ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
      : label
  })
  value = value
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
  value = value.replace(new RegExp(`${SENTINEL}c(\\d+)${SENTINEL}`, 'g'), (_match, index: string) =>
    `<code>${escapeHtml(code[Number(index)] ?? '')}</code>`)
  return value.replace(new RegExp(`${SENTINEL}i(\\d+)${SENTINEL}`, 'g'), (_match, index: string) =>
    `<span class="agent-remote-image">[image: ${escapeHtml(images[Number(index)] || 'omitted')}]</span>`)
}

const blockStart = (line: string): boolean =>
  /^(```|#{1,6}\s|>\s?|\s*([-*+]|\d+\.)\s+)/.test(line) || /^(---+|\*\*\*+)$/.test(line.trim())

export function renderAgentMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const output: string[] = []
  let index = 0
  while (index < lines.length) {
    const fence = /^```\s*([a-zA-Z0-9_+-]*)/.exec(lines[index].trim())
    if (fence) {
      const body: string[] = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith('```')) body.push(lines[index++])
      if (index < lines.length) index++
      const language = /^[a-zA-Z0-9_+-]+$/.test(fence[1]) ? fence[1] : 'text'
      output.push(`<pre><code data-language="${language}">${escapeHtml(body.join('\n'))}</code></pre>`)
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(lines[index])
    if (heading) {
      const level = heading[1].length
      output.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      index++
      continue
    }
    if (/^(---+|\*\*\*+)$/.test(lines[index].trim())) {
      output.push('<hr>')
      index++
      continue
    }
    if (/^>\s?/.test(lines[index])) {
      const body: string[] = []
      while (index < lines.length && /^>\s?/.test(lines[index])) body.push(lines[index++].replace(/^>\s?/, ''))
      output.push(`<blockquote>${inline(body.join('\n')).replace(/\n/g, '<br>')}</blockquote>`)
      continue
    }
    if (/^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
      const ordered = /^\s*\d+\.\s+/.test(lines[index])
      const items: string[] = []
      while (index < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index++].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
      }
      const tag = ordered ? 'ol' : 'ul'
      output.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`)
      continue
    }
    if (!lines[index].trim()) {
      index++
      continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim() && !blockStart(lines[index])) paragraph.push(lines[index++])
    output.push(`<p>${inline(paragraph.join('\n')).replace(/\n/g, '<br>')}</p>`)
  }
  return output.join('\n')
}
