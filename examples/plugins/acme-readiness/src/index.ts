import type { NodePlugin } from 'acorn-plugin-types'
import { source } from './source'

// scripts/manifest.mjs reads the source from the build to write the manifest entry.
export { source }

export default {
  // Must equal the manifest id.
  name: 'acme-readiness',
  init(ctx) {
    // The source owns the whole /v1/p/acme-readiness/ namespace, which is where the manifest's handler points.
    ctx.routes.fetch(source.fetch)
  },
} satisfies NodePlugin
