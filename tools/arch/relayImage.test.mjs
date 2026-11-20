// The relay image is built from committed sources and never takes a local credential file
// (docs/relay.md § Run your own relay).
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const text = (path) => readFileSync(join(root, path), 'utf8')
const BUILD = 'git archive --format=tar HEAD | docker build -f apps/relay/Dockerfile -t acorn-relay -'
const CREDENTIAL_RULES = ['**/.env*', '**/.npmrc', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx']

// What a relay build may use, and local files shaped like credentials that it must never send.
const KEPT = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'patches/fix.patch',
  'packages/protocol/src/relay.ts',
  'apps/relay/Dockerfile',
  'apps/relay/src/main.ts',
]
const DECOYS = [
  '.env',
  '.env.local',
  '.npmrc',
  'id_ed25519',
  'apps/node/.env.local',
  'scripts/deploy.env',
  'apps/relay/.env.production.local',
  'apps/relay/.npmrc',
  'apps/relay/tls.key',
  'apps/relay/src/cert.pem',
  'apps/relay/node_modules/leak/index.js',
  'packages/protocol/.env.development',
  'packages/protocol/src/signing.p12',
]

const dockerfile = text('apps/relay/Dockerfile')
const copied = [...dockerfile.matchAll(/^COPY (?!--from)(.+) \S+$/gm)].flatMap((match) => match[1].split(' '))
const ignoreRules = text('.dockerignore')
  .split('\n')
  .filter((line) => line && !line.startsWith('#'))

const fixtures = []
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-relay-context-'))
  fixtures.push(dir)
  for (const path of [...KEPT, ...DECOYS]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), DECOYS.includes(path) ? 'ACORN_DECOY_SECRET=do-not-ship\n' : '\n')
  }
  writeFileSync(join(dir, '.dockerignore'), text('.dockerignore'))
  return dir
}
afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })))

function filesUnder(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort()
}

const dockerAnswers =
  spawnSync('docker', ['buildx', 'version'], { timeout: 5000 }).status === 0 &&
  spawnSync('docker', ['info'], { timeout: 10000 }).status === 0

describe('the relay image', () => {
  it('copies only the sources the relay runs', () => {
    expect(copied).toEqual(['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'patches', 'packages/protocol', 'apps/relay'])
    expect(dockerfile).not.toMatch(/^ADD /m)
    for (const path of copied) expect(execFileSync('git', ['ls-files', '--', path], { cwd: root, encoding: 'utf8' })).not.toBe('')
  })

  it('has an ignore file that opens only those paths and then drops credential files', () => {
    expect(ignoreRules[0]).toBe('*')
    expect(ignoreRules.filter((rule) => rule.startsWith('!')).map((rule) => rule.slice(1))).toEqual(copied)
    const lastOpened = ignoreRules.findLastIndex((rule) => rule.startsWith('!'))
    for (const rule of CREDENTIAL_RULES) expect(ignoreRules.indexOf(rule)).toBeGreaterThan(lastOpened)
  })

  it('is documented as a build of a committed revision', () => {
    expect(text('docs/relay.md')).toContain(BUILD)
    expect(dockerfile).toContain(BUILD)
  })

  it('gets no uncommitted decoy from the documented build', () => {
    const dir = fixture()
    const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' })
    git('init', '-q')
    git('add', '--', ...KEPT)
    git('commit', '-q', '-m', 'fixture')
    const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { cwd: dir })
    const sent = execFileSync('tar', ['-t'], { input: archive, encoding: 'utf8' })
      .split('\n')
      .filter((entry) => entry && !entry.endsWith('/'))
    expect(sent.sort()).toEqual([...KEPT].sort())
  })

  // Exports the context the builder receives from a working checkout, through Docker's own matcher.
  it.skipIf(!dockerAnswers)('gets no decoy from a working checkout either', () => {
    const dir = fixture()
    const out = `${dir}-out`
    fixtures.push(out)
    execFileSync('docker', ['build', '-q', '-f', '-', '--output', `type=local,dest=${out}`, dir], {
      input: 'FROM scratch\nCOPY . /\n',
      stdio: ['pipe', 'ignore', 'pipe'],
    })
    expect(filesUnder(out)).toEqual([...KEPT].sort())
  }, 120000)
})
