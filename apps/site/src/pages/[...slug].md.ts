// Each docs page as Markdown at its URL plus `.md`, such as /docs/start/install.md, for an agent that
// reads one page. It's the Markdown /llms-full.txt holds for the page: rendered, then converted back,
// because the generated reference and component pages draw their facts with components.
import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection, type CollectionEntry } from 'astro:content'
import { entryToSimpleMarkdown } from 'starlight-llms-txt/render'

export const getStaticPaths = (async () => {
  const pages = await getCollection('docs', (page) => !page.data.draft && page.id !== '404')
  return pages.map((page) => ({ params: { slug: page.id }, props: { page } }))
}) satisfies GetStaticPaths

export const GET: APIRoute = async (context) => {
  const { page } = context.props as { page: CollectionEntry<'docs'> }
  const body = await entryToSimpleMarkdown(page, context)
  return new Response(`# ${page.data.title}\n\n> ${page.data.description}\n\n${body}\n`)
}
