// Three releases the download page has to handle: none, a macOS build only, and a file for every
// platform. releaseAssets.test.ts sorts them, and /lab/download/<name>/ draws the page with each.
import type { Release, ReleaseAsset } from './github.ts'

const asset = (name: string): ReleaseAsset => ({
  name,
  url: `https://github.com/jamesmacfie/acorn/releases/download/v1.0.0/${name}`,
  size: 1,
})

const release = (names: string[]): Release => ({
  tag: 'v1.0.0',
  url: 'https://github.com/jamesmacfie/acorn/releases/tag/v1.0.0',
  publishedAt: '2026-11-02T09:00:00Z',
  assets: names.map(asset),
})

export const fixtureReleases: Record<string, Release | null> = {
  none: null,
  'macos-only': release(['acorn_1.0.0_aarch64.dmg', 'acorn_1.0.0_x64.dmg', 'acorn.app.tar.gz', 'acorn.app.tar.gz.sig']),
  'every-platform': release([
    'acorn_1.0.0_aarch64.dmg',
    'acorn_1.0.0_x64.dmg',
    'acorn.app.tar.gz',
    'acorn.app.tar.gz.sig',
    'acorn_1.0.0_x64-setup.exe',
    'acorn_1.0.0_x64-setup.exe.sig',
    'acorn-node-1.0.0.tar.gz',
    'SHA256SUMS',
  ]),
}
