import { z } from 'astro/zod'

// What every written page declares, so the staleness report reads docs pages and marketing pages the
// same way (docs/site.md).
export const pageMeta = z.object({
  // One sentence. It becomes the meta description and the search summary.
  description: z.string().min(1),
  // The internal docs and source files the page was written from, as repository paths.
  sources: z.array(z.string().min(1)).min(1),
  // The commit at which the page last matched its sources.
  checked: z.string().regex(/^[0-9a-f]{7,40}$/, 'a commit hash'),
})

export type PageMeta = z.infer<typeof pageMeta>
