// Each docs page's head, once Starlight has filled in its title, description, canonical URL, and `og:`
// tags: the social card of the page's sidebar group, and a title that names the group when another page
// has the same title, such as Settings > Agents and the Agents plugin (docs/site/agent-outputs.md §
// Page metadata).
import { defineRouteMiddleware } from '@astrojs/starlight/route-data'
import { getCollection } from 'astro:content'
import { docsSection } from './nav'
import { FALLBACK_CARD } from './og'

const titleCounts = getCollection('docs', ({ data }) => !data.draft).then((pages) => {
  const counts = new Map<string, number>()
  for (const { data } of pages) counts.set(data.title, (counts.get(data.title) ?? 0) + 1)
  return counts
})

export const onRequest = defineRouteMiddleware(async (context) => {
  const { entry, head, sidebar } = context.locals.starlightRoute
  const section = docsSection(sidebar, context.url.pathname)
  const title = head.find(({ tag }) => tag === 'title')
  if (section && title && (await titleCounts).get(entry.data.title)! > 1) {
    title.content = `${entry.data.title} · ${section.label} · acorn docs`
  }
  const image = new URL(`/og/${section?.card ?? FALLBACK_CARD}.png`, context.site).href
  head.push(
    { tag: 'meta', attrs: { property: 'og:image', content: image } },
    { tag: 'meta', attrs: { property: 'og:image:width', content: '1200' } },
    { tag: 'meta', attrs: { property: 'og:image:height', content: '630' } },
    { tag: 'meta', attrs: { name: 'twitter:image', content: image } },
  )
})
