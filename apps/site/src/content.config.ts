import { defineCollection } from 'astro:content'
import { z } from 'astro/zod'
import { docsLoader } from '@astrojs/starlight/loaders'
import { docsSchema } from '@astrojs/starlight/schema'
import { pageMeta } from './meta'

const previewBuild = process.env.ACORN_SITE_PREVIEW === '1'

// Starlight leaves a draft out of every production build. A preview deploy is a production build that
// should still show drafts, so there a draft is published with a banner instead, and kept out of search.
const showDraftOnPreview = <T extends { draft: boolean; pagefind: boolean; banner?: { content: string } }>(
  page: T,
): T =>
  previewBuild && page.draft
    ? {
        ...page,
        draft: false,
        pagefind: false,
        banner: { content: 'Draft: this page is not published to getacorn.dev yet.' },
      }
    : page

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: (context) =>
      docsSchema({
        extend: pageMeta.extend({
          // Settings page IDs this page documents, for the settings coverage check.
          covers: z.array(z.string()).optional(),
        }),
      })(context).transform(showDraftOnPreview),
  }),
}
