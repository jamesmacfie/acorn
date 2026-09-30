import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = new URL('../../', import.meta.url)
type Manifest = {
  overrides: Record<string, string>
  acornStandalone: {
    dependencyPins: Record<string, string>
    peerOverrides: Record<string, Record<string, string>>
  }
}
const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as Manifest

it('pnpm and the standalone npm manifest use the same runtime security floors', () => {
  const workspace = readFileSync(new URL('pnpm-workspace.yaml', root), 'utf8')
  const section = workspace.split('\noverrides:\n')[1]?.split('\npatchedDependencies:')[0]
  expect(section, fileURLToPath(root)).toBeDefined()
  const overrides = Object.fromEntries(
    [...section!.matchAll(/^  (?:"([^"]+)"|([^ :]+)): "([^"]+)"$/gm)].map((match) => [match[1] ?? match[2], match[3]]),
  )
  expect(Object.keys(manifest.overrides).length).toBeGreaterThan(0)
  for (const [name, version] of Object.entries(manifest.overrides)) expect(overrides[name], name).toBe(version)
})

it('standalone provider pins match the workspace version and optional peers reference its direct dependencies', () => {
  const tui = JSON.parse(readFileSync(new URL('apps/tui/package.json', root), 'utf8')) as { dependencies: Record<string, string> }
  const lock = readFileSync(new URL('pnpm-lock.yaml', root), 'utf8')
  for (const [name, version] of Object.entries(manifest.acornStandalone.dependencyPins)) {
    expect(tui.dependencies[name], name).toBe(`^${version}`)
    expect(lock, name).toContain(`'${name}@${version}':`)
  }
  for (const [provider, peers] of Object.entries(manifest.acornStandalone.peerOverrides)) {
    expect(manifest.acornStandalone.dependencyPins[provider], provider).toBeDefined()
    expect(manifest.overrides[provider], provider).toBeUndefined()
    for (const [name, reference] of Object.entries(peers)) {
      expect(reference).toBe(`$${name}`)
      expect(tui.dependencies[name], name).toBeDefined()
    }
  }
})
