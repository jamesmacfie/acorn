// The site's one script. wrangler.jsonc runs it only for /download/<file>: it records the download in
// Workers Analytics Engine, then redirects to the file on GitHub. Cloudflare serves every other path
// straight from dist. The paths and files come from /download/links.json, which the build writes.
// The types are written out here because the site doesn't install Cloudflare's.

interface Env {
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> }
  DOWNLOADS: { writeDataPoint(point: { blobs?: string[]; indexes?: string[] }): void }
}

interface Links {
  tag: string | null
  files: Record<string, string>
}

// Preview versions share the dataset, so only visits to the production site count.
const PRODUCTION_HOST = 'getacorn.dev'

export default {
  async fetch(request: Request & { cf?: { country?: string } }, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const links = await env.ASSETS.fetch(new URL('/download/links.json', url))
    const { tag, files }: Links = links.ok ? await links.json() : { tag: null, files: {} }
    const file = files[url.pathname]
    // An unknown path gets the site's 404 page.
    if (!file) return env.ASSETS.fetch(request)
    if (url.hostname === PRODUCTION_HOST) {
      env.DOWNLOADS.writeDataPoint({
        indexes: [url.pathname],
        blobs: [url.pathname, tag ?? '', request.cf?.country ?? ''],
      })
    }
    return Response.redirect(file, 302)
  },
}
