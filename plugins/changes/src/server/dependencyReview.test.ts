import { afterEach, beforeEach, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { git as readGit } from '@acorn/plugin-api/node'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { dependencyReview, staticDependencyPolicy } from './dependencyReview'

let root: string
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
const put = (name: string, text: string) => writeFile(join(root, name), text)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'acorn-dependency-review-'))
  git('init', '-q')
  git('config', 'user.email', 'review@example.test')
  git('config', 'user.name', 'Review')
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

it('keeps staged bytes separate from a later disk edit and changes the revision on stage', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { safe: '1.0.0' } }))
  await put('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': {}, 'node_modules/safe': { version: '1.0.0', resolved: 'https://registry.example/safe.tgz', integrity: 'sha512-old' } } }))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { safe: '2.0.0' } }))
  git('add', 'package.json')
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { unsafe: '3.0.0' } }))
  const staged = await dependencyReview(root, 'staged')
  const unstaged = await dependencyReview(root, 'unstaged')
  expect(staged.findings.some((item) => item.kind === 'direct' && item.after === '2.0.0')).toBe(true)
  expect(JSON.stringify(staged)).not.toContain('unsafe')
  expect(unstaged.findings.some((item) => item.kind === 'direct' && item.name.includes('unsafe'))).toBe(true)
  const previous = staged.revision
  git('add', 'package.json')
  expect((await dependencyReview(root, 'staged')).revision).not.toBe(previous)
})

it('reports npm transitive version, source, and integrity edits at one install path', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { direct: '^1' } }))
  const lock = (version: string, resolved: string, integrity?: string) => JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { direct: '^1' } },
    'node_modules/direct': { version: '1.0.0', resolved: 'https://registry.example/direct.tgz', integrity: 'sha512-direct' },
    'node_modules/transitive': { version, resolved, ...(integrity ? { integrity } : {}) },
  } })
  await put('package-lock.json', lock('1.0.0', 'https://registry.example/transitive.tgz', 'sha512-old'))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package-lock.json', lock('2.0.0', 'git+https://user:secret@git.example/transitive#abcdef0'))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'transitive', name: 'transitive', before: '1.0.0', after: '2.0.0' }),
    expect.objectContaining({ kind: 'source', name: 'transitive' }),
    expect.objectContaining({ kind: 'integrity', name: 'transitive', before: 'sha512-old', after: null }),
  ]))
  expect(JSON.stringify(review)).not.toContain('secret')
})

it('classifies npm root alias resolution as direct and counts one package', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { alias: 'npm:actual@^1' } }))
  const lock = (version: string) => JSON.stringify({ lockfileVersion: 3, packages: {
    '': { dependencies: { alias: 'npm:actual@^1' } },
    'node_modules/alias': { name: 'actual', version, resolved: `https://registry.example/actual-${version}.tgz`, integrity: 'sha512-same' },
  } })
  await put('package-lock.json', lock('1.0.0'))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package-lock.json', lock('1.1.0'))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.findings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'direct', name: 'actual', before: '1.0.0', after: '1.1.0' })]))
  expect(review.packageCount).toBe(1)
})

it('shows source, integrity, policy, and lifecycle changes without claiming installed scripts', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0', dependencies: { alias: 'npm:actual@1.0.0' } }))
  await put('pnpm-workspace.yaml', 'packages: []\nminimumReleaseAge: 1440\nallowBuilds:\n  safe: true\n')
  await put('.npmrc', 'registry=https://user:old-secret@registry.example/private?token=old-secret\n')
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alias:\n        specifier: npm:actual@1.0.0\n        version: actual@1.0.0(peer@1)\npackages:\n  actual@1.0.0:\n    resolution:\n      integrity: sha512-old\nsnapshots:\n  actual@1.0.0(peer@1): {}\n")
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0', dependencies: { alias: 'npm:actual@2.0.0' }, scripts: { postinstall: 'node build.js' } }))
  await put('pnpm-workspace.yaml', 'packages: []\nminimumReleaseAge: 60\nminimumReleaseAgeExclude:\n  - actual\nallowBuilds:\n  safe: true\n  actual: true\n')
  await put('.npmrc', 'registry=https://user:secret@registry.example/private?token=secret\n')
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      alias:\n        specifier: npm:actual@2.0.0\n        version: actual@2.0.0(peer@2)\npackages:\n  actual@2.0.0:\n    resolution:\n      tarball: https://user:secret@git.example/pkg.tgz?token=secret#rev2\nsnapshots:\n  actual@2.0.0(peer@2): {}\n")
  const review = await dependencyReview(root, 'unstaged')
  expect(review.findings.some((item) => item.kind === 'policy' && item.name.includes('minimumReleaseAgeExclude'))).toBe(true)
  expect(review.findings.find((item) => item.name.includes('minimumReleaseAgeExclude'))?.warning).toBe(true)
  expect(review.findings.some((item) => item.kind === 'script' && item.name.includes('postinstall'))).toBe(true)
  expect(review.findings.some((item) => item.kind === 'source' && item.after?.includes('git.example'))).toBe(true)
  expect(review.findings.some((item) => item.kind === 'integrity' && item.before === 'sha512-old')).toBe(true)
  expect(JSON.stringify(review)).not.toContain('secret')
  expect(review.limits.join(' ')).toContain('Installed dependency scripts')
  const policy = await staticDependencyPolicy(root)
  expect(policy).toMatchObject({ releaseAgeMinutes: 60, buildApprovalCount: 2, releaseAgeExceptionCount: 1, registryOrigins: ['https://registry.example'] })
  expect(JSON.stringify(policy)).not.toContain('secret')
  expect(policy.limits.join(' ')).not.toContain('lockfile resolution is missing')
})

it('returns partial evidence for malformed locks and refuses a symlinked project file', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0' }))
  await put('package-lock.json', '{broken')
  const outside = join(tmpdir(), `acorn-dependency-outside-${Date.now()}`)
  await writeFile(outside, 'registry=https://outside.example/')
  await symlink(outside, join(root, '.npmrc'))
  try {
    const review = await dependencyReview(root, 'unstaged')
    expect(review.coverage).toBe('partial')
    expect(review.limits.join(' ')).toMatch(/malformed|unreadable/)
    const policy = await staticDependencyPolicy(root)
    expect(policy.limits.join(' ')).toContain('.npmrc')
  } finally { await rm(outside, { force: true }) }
})

it('retains optional, workspace, alias, and peer resolution identities', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0', optionalDependencies: { alias: 'npm:actual@1.0.0', local: 'workspace:*' } }))
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    optionalDependencies:\n      alias:\n        specifier: npm:actual@1.0.0\n        version: actual@1.0.0(peer@1)\n      local:\n        specifier: workspace:*\n        version: link:packages/local\npackages:\n  actual@1.0.0:\n    resolution:\n      integrity: sha512-actual\nsnapshots:\n  actual@1.0.0(peer@1):\n    optional: true\n")
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .:\n    optionalDependencies:\n      alias:\n        specifier: npm:actual@1.0.0\n        version: actual@1.0.0(peer@2)\n      local:\n        specifier: workspace:*\n        version: link:packages/local\npackages:\n  actual@1.0.0:\n    resolution:\n      integrity: sha512-actual\nsnapshots:\n  actual@1.0.0(peer@2):\n    optional: true\n")
  const review = await dependencyReview(root, 'unstaged')
  expect(review.findings.some((item) => item.kind === 'direct' && item.name.includes('resolved optionalDependencies:alias') && item.after === 'actual@1.0.0(peer@2)')).toBe(true)
  expect(review.findings.some((item) => item.kind === 'direct' && item.detail === 'actual@1.0.0(peer@2)')).toBe(true)
  expect(review.packageCount).toBe(1)
  expect(review.findings.some((item) => item.name.includes('local'))).toBe(false)
})

it('detects a changed existing lifecycle command and policy edits beyond the display cap', async () => {
  const make = (command: string, last: string) => JSON.stringify({ packageManager: 'pnpm@11.0.0', scripts: { postinstall: command }, pnpm: { overrides: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`pkg-${i}`, i === 119 ? last : '1'])) } })
  await put('package.json', make('node harmless.js', '1'))
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n")
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package.json', make('node dangerous.js', '2'))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.findings).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: 'script', before: 'declared', after: 'declared', detail: expect.stringContaining('command changed') }),
    expect.objectContaining({ kind: 'policy', name: 'pnpm.overrides', detail: expect.stringContaining('Full value changed') }),
  ]))
  expect(JSON.stringify(review)).not.toContain('dangerous.js')
})

it('marks a new npm workspace importer absent from the lockfile as partial', async () => {
  await mkdir(join(root, 'packages', 'new'), { recursive: true })
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', workspaces: ['packages/*'] }))
  await put('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { workspaces: ['packages/*'] } } }))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('packages/new/package.json', JSON.stringify({ dependencies: { missing: '1' } }))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.coverage).toBe('partial')
  expect(review.limits.join(' ')).toContain('manifest importer is absent')
})

it('marks a new pnpm workspace importer absent from the lockfile as partial', async () => {
  await mkdir(join(root, 'packages', 'new'), { recursive: true })
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0' }))
  await put('pnpm-workspace.yaml', "packages:\n  - packages/*\n")
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n")
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('packages/new/package.json', JSON.stringify({ dependencies: { missing: '1' } }))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.coverage).toBe('partial')
  expect(review.limits.join(' ')).toContain('manifest importer is absent')
})

it('detects a pnpm Git commit-only resolution change', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0' }))
  const lock = (commit: string) => `lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n  git-package@1.0.0:\n    resolution:\n      repo: https://git.example/repo\n      type: git\n      commit: ${commit}\n`
  await put('pnpm-lock.yaml', lock('aaaaaaa'))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('pnpm-lock.yaml', lock('bbbbbbb'))
  expect((await dependencyReview(root, 'unstaged')).findings.some((finding) => finding.kind === 'source' && finding.before?.includes('aaaaaaa') && finding.after?.includes('bbbbbbb'))).toBe(true)
})

it('marks malformed supported resolution tables partial', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0' }))
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\npackages:\n  pkg@1.0.0:\n    resolution: invalid\n")
  const review = await dependencyReview(root, 'unstaged')
  expect(review.coverage).toBe('partial')
  expect(review.limits.join(' ')).toContain('Lockfile is malformed')
})

it('accepts the repository-sized supported pnpm lock within structural bounds', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0' }))
  await copyFile(resolve(import.meta.dirname, '../../../..', 'pnpm-lock.yaml'), join(root, 'pnpm-lock.yaml'))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.limits.join(' ')).not.toContain('Lockfile is malformed')
})

it('refuses a mixed index generation while reading immutable blobs', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { item: '1' } }))
  git('add', '.')
  git('commit', '-qm', 'initial')
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { item: '2' } }))
  git('add', '.')
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { item: '3' } }))
  let moved = false
  const run: typeof readGit = async (args, options) => {
    if (!moved && args[0] === 'cat-file') { moved = true; git('add', 'package.json') }
    return readGit(args, options)
  }
  const review = await dependencyReview(root, 'staged', root, run)
  expect(review.coverage).toBe('partial')
  expect(review.findings).toHaveLength(0)
  expect(review.limits.join(' ')).toContain('changed during review')
})

it('labels an unsupported lock version without a false complete result', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'npm@11.0.0', dependencies: { a: '1' } }))
  await put('package-lock.json', JSON.stringify({ lockfileVersion: 1, dependencies: { a: { version: '1' } } }))
  const review = await dependencyReview(root, 'unstaged')
  expect(review.coverage).toBe('partial')
  expect(review.limits.join(' ')).toContain('Unsupported npm lockfile version')
  expect(review.findings.every((item) => item.kind !== 'transitive')).toBe(true)
})

it('keeps Python and executable config changes visible as incomplete beside pnpm', async () => {
  await put('package.json', JSON.stringify({ packageManager: 'pnpm@11.0.0' }))
  await put('pnpm-lock.yaml', "lockfileVersion: '9.0'\nimporters:\n  .: {}\n")
  await put('pyproject.toml', '[project]\ndependencies = ["unknown"]\n')
  await put('.pnpmfile.cjs', 'module.exports = {}\n')
  const review = await dependencyReview(root, 'unstaged')
  expect(review.coverage).toBe('partial')
  expect(review.limits.join(' ')).toContain('Python dependencies are unsupported')
  expect(review.limits.join(' ')).toContain('executable configuration')
})
