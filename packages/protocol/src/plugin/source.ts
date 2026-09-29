import type { PluginInstallSource } from '../transport/api.ts'

export const RELEASE_ASSET = 'acorn-plugin.tgz'
export type ResolvedPluginSource = { url: string; provenance: Record<string, string> }

export function describePluginSource(source: PluginInstallSource): string {
  return 'github' in source
    ? `github:${source.github}${source.tag ? `@${source.tag}` : ''}`
    : 'npm' in source
      ? `npm:${source.npm}${source.version ? `@${source.version}` : ''}`
      : 'url' in source ? source.url : `path:${source.path}`
}

export function guardPluginUrl(raw: string): void {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(`'${raw}' is not a URL.`) }
  if (url.protocol === 'https:') return
  if (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)) return
  throw new Error('A plugin package must be fetched over https (http is accepted only from localhost).')
}

/** Browser-safe source resolution. The host supplies fetch and owns byte limits and placement. */
export async function resolvePluginSource(source: PluginInstallSource, fetcher: typeof fetch = fetch): Promise<ResolvedPluginSource> {
  if ('path' in source) throw new Error('A folder has no download URL.')
  if ('url' in source) {
    guardPluginUrl(source.url)
    return { url: source.url, provenance: {} }
  }
  const json = async (url: string, accept: string): Promise<unknown> => {
    guardPluginUrl(url)
    const response = await fetcher(url, { headers: { accept }, signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`${url} answered ${response.status}.`)
    return response.json()
  }
  if ('github' in source) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(source.github)) throw new Error(`'${source.github}' is not an owner/repo pair.`)
    const base = `https://api.github.com/repos/${source.github}/releases`
    const release = await json(source.tag ? `${base}/tags/${encodeURIComponent(source.tag)}` : `${base}/latest`, 'application/vnd.github+json') as {
      tag_name?: string; assets?: { name?: string; browser_download_url?: string }[]
    }
    const asset = release.assets?.find((candidate) => candidate.name === RELEASE_ASSET)
    if (!asset?.browser_download_url) throw new Error(`That release has no ${RELEASE_ASSET} asset.`)
    guardPluginUrl(asset.browser_download_url)
    return { url: asset.browser_download_url, provenance: { tag: release.tag_name ?? source.tag ?? 'latest' } }
  }
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(source.npm)) throw new Error(`'${source.npm}' is not an npm package name.`)
  const packument = await json(`https://registry.npmjs.org/${source.npm.replace('/', '%2f')}`, 'application/json') as {
    'dist-tags'?: Record<string, string>; versions?: Record<string, { dist?: { tarball?: string; integrity?: string } }>
  }
  const version = source.version ?? packument['dist-tags']?.latest
  if (!version) throw new Error(`${source.npm} has no published version to install.`)
  const dist = packument.versions?.[version]?.dist
  if (!dist?.tarball) throw new Error(`${source.npm}@${version} has no tarball on the registry.`)
  guardPluginUrl(dist.tarball)
  return { url: dist.tarball, provenance: { version, ...(dist.integrity ? { integrity: dist.integrity } : {}) } }
}
