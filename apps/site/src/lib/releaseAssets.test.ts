import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadLinks, sortAssets } from './releaseAssets.ts'
import { fixtureReleases } from './releaseFixtures.ts'

const kinds = (name: string) => Object.keys(sortAssets(fixtureReleases[name]?.assets ?? []))

test('no release offers no downloads', () => {
  assert.deepEqual(kinds('none'), [])
})

test("a macOS-only release offers both Macs, and not the updater's files", () => {
  const downloads = sortAssets(fixtureReleases['macos-only']!.assets)
  assert.deepEqual(Object.keys(downloads), ['macosArm64', 'macosX64'])
  assert.equal(downloads.macosArm64?.name, 'acorn_1.0.0_aarch64.dmg')
  assert.equal(downloads.macosX64?.name, 'acorn_1.0.0_x64.dmg')
})

test('a release for every platform offers every download', () => {
  const downloads = sortAssets(fixtureReleases['every-platform']!.assets)
  assert.deepEqual(Object.keys(downloads), ['macosArm64', 'macosX64', 'windows', 'node', 'checksums'])
  assert.equal(downloads.windows?.name, 'acorn_1.0.0_x64-setup.exe')
  assert.equal(downloads.node?.name, 'acorn-node-1.0.0.tar.gz')
  assert.equal(downloads.checksums?.name, 'SHA256SUMS')
})

// These paths are public addresses, and src/worker.ts counts downloads under them. Renaming one splits its count.
test('each download gets a path on the site', () => {
  assert.deepEqual(Object.keys(downloadLinks(fixtureReleases['every-platform']!).files), [
    '/download/macos-arm64',
    '/download/macos-x64',
    '/download/windows',
    '/download/node',
    '/download/checksums',
  ])
  assert.deepEqual(downloadLinks(null), { tag: null, files: {} })
})
