// The standalone release installs only the reviewed dependency graph and never replaces a published
// file (docs/node-distribution/dependency-security.md).
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { allowedInstallScripts, reviewedLock, standaloneManifest } from '../../scripts/node-standalone-lock.mjs'

const root = new URL('../../', import.meta.url)
const text = (path) => readFileSync(new URL(path, root), 'utf8')

describe('the reviewed standalone lockfile', () => {
  const { manifest, lock } = reviewedLock()

  it('was resolved from the manifest the workspace produces now', () => {
    // On failure: run `pnpm lock:node`, review the lockfile diff, and commit both files.
    expect(manifest).toEqual(standaloneManifest().manifest)
    expect(lock.packages[''].dependencies).toEqual(manifest.dependencies)
  })

  it('lets only the reviewed install scripts run', () => {
    expect(allowedInstallScripts(lock)).toEqual(['node-pty'])
  })

  it('pins every package to a registry tarball and its integrity hash', () => {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue
      expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//)
      expect(entry.integrity, path).toMatch(/^sha512-/)
    }
  })
})

describe('allowedInstallScripts', () => {
  const lock = (...paths) => ({ packages: { '': {}, ...Object.fromEntries(paths.map((path) => [path, { hasInstallScript: true }])) } })

  it('runs the allowed scripts, skips the refused ones, and names nested copies by package', () => {
    const allowBuilds = { 'node-pty': 'true', '@scope/native': 'true', telemetry: 'false' }
    expect(
      allowedInstallScripts(lock('node_modules/node-pty', 'node_modules/a/node_modules/@scope/native', 'node_modules/telemetry'), allowBuilds),
    ).toEqual(['@scope/native', 'node-pty'])
  })

  it('refuses a package whose install script nobody reviewed', () => {
    expect(() => allowedInstallScripts(lock('node_modules/node-pty', 'node_modules/postinstall-surprise'), { 'node-pty': 'true' })).toThrow(
      /unreviewed install scripts: postinstall-surprise/,
    )
  })
})

it('the container installs exact agent CLI versions', () => {
  const dockerfile = text('apps/node/Dockerfile')
  expect(dockerfile).toMatch(/^ARG CLAUDE_CODE_VERSION=\d+\.\d+\.\d+$/m)
  expect(dockerfile).toMatch(/^ARG CODEX_VERSION=\d+\.\d+\.\d+$/m)
  expect(dockerfile).toContain('"@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" "@openai/codex@${CODEX_VERSION}"')
})

it('a release rerun never replaces a published archive or image', () => {
  const workflow = text('.github/workflows/build-node.yml')
  expect(workflow).not.toMatch(/gh release upload[^\n]*--clobber/)
  expect(workflow).toContain('gh release upload "$TAG" archives/*\n')
  expect(workflow).toContain('docker manifest inspect "$image:$version"')
})
