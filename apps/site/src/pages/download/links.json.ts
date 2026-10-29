// The GitHub file behind each download path, for src/worker.ts. It's built with the site, so the daily
// and per-release rebuilds keep it on the newest release.
import type { APIRoute } from 'astro'
import { readGithub } from '../../lib/github'
import { downloadLinks } from '../../lib/releaseAssets'

export const GET: APIRoute = async () => Response.json(downloadLinks((await readGithub()).release))
