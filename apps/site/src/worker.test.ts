import assert from 'node:assert/strict'
import { test } from 'node:test'
import { downloadLinks } from './lib/releaseAssets.ts'
import { fixtureReleases } from './lib/releaseFixtures.ts'
import worker from './worker.ts'

// A stand-in for the assets binding that serves links.json for the every-platform fixture, and a 404
// for anything else.
function env() {
  const points: { blobs?: string[]; indexes?: string[] }[] = []
  return {
    points,
    ASSETS: {
      async fetch(input: Request | URL | string) {
        const { pathname } = new URL(input instanceof Request ? input.url : input)
        return pathname === '/download/links.json'
          ? Response.json(downloadLinks(fixtureReleases['every-platform']!))
          : new Response('Not found', { status: 404 })
      },
    },
    DOWNLOADS: { writeDataPoint: (point: { blobs?: string[]; indexes?: string[] }) => void points.push(point) },
  }
}

const visit = (url: string, bindings: ReturnType<typeof env>) =>
  worker.fetch(Object.assign(new Request(url), { cf: { country: 'NZ' } }), bindings)

test('a download on the production site is counted and redirected to GitHub', async () => {
  const bindings = env()
  const response = await visit('https://acorn.sh/download/macos-arm64', bindings)
  assert.equal(response.status, 302)
  assert.equal(
    response.headers.get('location'),
    'https://github.com/jamesmacfie/acorn/releases/download/v1.0.0/acorn_1.0.0_aarch64.dmg',
  )
  assert.deepEqual(bindings.points, [{ indexes: ['/download/macos-arm64'], blobs: ['/download/macos-arm64', 'v1.0.0', 'NZ'] }])
})

test('a download on a preview redirects without being counted', async () => {
  const bindings = env()
  const response = await visit('https://pr-1-acorn-site.example.workers.dev/download/node', bindings)
  assert.equal(response.status, 302)
  assert.deepEqual(bindings.points, [])
})

test('an unknown download path gets the 404 page and no count', async () => {
  const bindings = env()
  const response = await visit('https://acorn.sh/download/linux-riscv', bindings)
  assert.equal(response.status, 404)
  assert.deepEqual(bindings.points, [])
})
