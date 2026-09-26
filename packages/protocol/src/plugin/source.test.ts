import { describe, expect, it, vi } from 'vitest'
import { resolvePluginSource } from './source.ts'

describe('plugin source resolution', () => {
  it('resolves a GitHub release asset with an injected fetch', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v1.2.0', assets: [{ name: 'acorn-plugin.tgz', browser_download_url: 'https://example.com/plugin.tgz' }],
    }), { status: 200 })) as unknown as typeof fetch
    expect(await resolvePluginSource({ github: 'owner/repo' }, fetcher)).toEqual({
      url: 'https://example.com/plugin.tgz', provenance: { tag: 'v1.2.0' },
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('refuses a release asset URL that downgrades to cleartext', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      assets: [{ name: 'acorn-plugin.tgz', browser_download_url: 'http://example.com/plugin.tgz' }],
    }), { status: 200 })) as unknown as typeof fetch
    await expect(resolvePluginSource({ github: 'owner/repo' }, fetcher)).rejects.toThrow('https')
  })
})
