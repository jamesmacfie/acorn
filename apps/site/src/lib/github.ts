// What the site reads from GitHub when it builds: the star count and the newest published release.
// The visitor's browser asks GitHub for nothing. When GitHub doesn't answer, or `SITE_OFFLINE=1`, the
// build uses the copy in src/data/github.json, which `pnpm --filter @acorn/site github:refresh` rewrites.
import committed from '../data/github.json' with { type: 'json' }
import { GITHUB } from '../nav.ts'

export interface ReleaseAsset {
  name: string
  url: string
  size: number
}

export interface Release {
  tag: string
  url: string
  publishedAt: string
  assets: ReleaseAsset[]
}

interface GithubData {
  stars: number
  release: Release | null
}

const API = `https://api.github.com/repos${new URL(GITHUB).pathname}`

async function api(path: string) {
  // CI passes its token, because the anonymous limit is 60 requests an hour per address.
  const token = process.env.GITHUB_TOKEN
  const response = await fetch(`${API}${path}`, {
    headers: { accept: 'application/vnd.github+json', ...(token && { authorization: `Bearer ${token}` }) },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`GitHub answered ${response.status} for ${API}${path}`)
  return response.json()
}

/** Asks GitHub for the star count and the newest release that isn't a draft. */
export async function fetchGithub(): Promise<GithubData> {
  const [repo, releases] = await Promise.all([api(''), api('/releases?per_page=10')])
  const newest = releases.find((release: { draft: boolean }) => !release.draft)
  return {
    stars: repo.stargazers_count,
    release: newest
      ? {
          tag: newest.tag_name,
          url: newest.html_url,
          publishedAt: newest.published_at,
          assets: newest.assets.map((asset: { name: string; browser_download_url: string; size: number }) => ({
            name: asset.name,
            url: asset.browser_download_url,
            size: asset.size,
          })),
        }
      : null,
  }
}

let read: Promise<GithubData> | undefined

/** What the build shows. Every page shares one answer, so a build asks GitHub once. */
export function readGithub() {
  read ??=
    process.env.SITE_OFFLINE === '1'
      ? Promise.resolve(committed as GithubData)
      : fetchGithub().catch((error: Error) => {
          console.warn(`[site] Using src/data/github.json, because GitHub didn't answer: ${error.message}`)
          return committed as GithubData
        })
  return read
}
