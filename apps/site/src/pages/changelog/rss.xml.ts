// The changelog as an RSS 2.0 feed, one item per entry, linking to the entry's anchor on /changelog/.
import type { APIRoute } from 'astro'
import { changelog, escapeHtml, textToHtml } from '../../data/changelog'

export const GET: APIRoute = ({ site }) => {
  const page = new URL('/changelog/', site)
  const feed = new URL('/changelog/rss.xml', site)
  const items = changelog.map((entry) => {
    const link = `${page}#${entry.date}`
    const changes = entry.changes.map((change) => `<li>${change.kind}: ${textToHtml(change.text)}</li>`).join('')
    const description = `<p>${textToHtml(entry.summary)}</p><ul>${changes}</ul>`
    return `
    <item>
      <title>${escapeHtml(entry.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(`${entry.date}T00:00:00Z`).toUTCString()}</pubDate>
      <description>${escapeHtml(description)}</description>
    </item>`
  })
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>acorn changelog</title>
    <link>${page}</link>
    <description>What changed in acorn, newest first.</description>
    <language>en</language>
    <atom:link href="${feed}" rel="self" type="application/rss+xml" />${items.join('')}
  </channel>
</rss>
`
  return new Response(xml, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } })
}
