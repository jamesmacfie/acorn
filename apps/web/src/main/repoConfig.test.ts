import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { legacyRunTargets, loadRepoConfig } from './repoConfig'

describe('loadRepoConfig (docs/next 13 §B)', () => {
  let dir: string
  let repoDir: string
  let userDir: string

  const writeConfig = (base: string, text: string) => {
    mkdirSync(join(base, '.acorn'), { recursive: true })
    writeFileSync(join(base, '.acorn', 'config.toml'), text)
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-cfg-'))
    repoDir = join(dir, 'repo')
    userDir = join(dir, 'home')
    mkdirSync(repoDir)
    mkdirSync(userDir)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('absent files → DB fallback, byte-for-byte today’s behaviour', () => {
    const cfg = loadRepoConfig(repoDir, userDir, {
      setupScript: './setup.sh',
      teardownScript: 'docker compose down',
      runCommand: 'pnpm dev',
      devPort: 3000,
    })
    expect(cfg.errors).toEqual([])
    expect(cfg.scripts).toEqual({ setup: './setup.sh', archive: 'docker compose down' })
    expect(cfg.runTargets).toEqual([{ id: 'dev', command: 'pnpm dev', default: true, url: 'http://localhost:3000' }])
    expect(cfg.copy).toEqual([])
  })

  it('a committed repo config wins over user config over DB', () => {
    writeConfig(userDir, `
[scripts]
setup = "user-setup"
[scripts.run.dev]
command = "user-dev"
[scripts.run.lint]
command = "pnpm lint"
`)
    writeConfig(repoDir, `
[scripts]
setup = "repo-setup"
[scripts.run.dev]
command = "./scripts/dev.sh"
url_command = "./scripts/dev-url.sh"
default = true
[scripts.run.stack]
command = "docker compose -p acorn-$ACORN_TASK_SLUG up"
stop = "docker compose -p acorn-$ACORN_TASK_SLUG down"
url = "http://localhost:8080"
copy = [".env.local"]
`)
    const cfg = loadRepoConfig(repoDir, userDir, { setupScript: 'db-setup', runCommand: 'pnpm dev', devPort: 3000 })
    expect(cfg.errors).toEqual([])
    expect(cfg.scripts.setup).toBe('repo-setup')
    const ids = cfg.runTargets.map((t) => t.id).sort()
    expect(ids).toEqual(['dev', 'lint', 'stack'])
    const dev = cfg.runTargets.find((t) => t.id === 'dev')
    expect(dev).toEqual({ id: 'dev', command: './scripts/dev.sh', urlCommand: './scripts/dev-url.sh', default: true, stop: undefined, url: undefined, icon: undefined })
    const stack = cfg.runTargets.find((t) => t.id === 'stack')
    expect(stack?.stop).toContain('down')
    expect(stack?.url).toBe('http://localhost:8080')
  })

  it('parses copy + archive-as-table and layout recipes', () => {
    writeConfig(repoDir, `
copy = [".env.local", ".env.development"]
[scripts.archive]
command = "docker compose down"
[layout.review]
panes = ["pr", "changes"]
ratio = 0.5
terminal = "dev"
browser = "run:dev"
`)
    const cfg = loadRepoConfig(repoDir, null, {})
    expect(cfg.errors).toEqual([])
    expect(cfg.copy).toEqual(['.env.local', '.env.development'])
    expect(cfg.scripts.archive).toBe('docker compose down')
    expect(cfg.layouts).toEqual([{ id: 'review', panes: ['pr', 'changes'], ratio: 0.5, terminal: 'dev', browser: 'run:dev' }])
  })

  it('malformed TOML → structured error, not a throw; falls back to lower layers', () => {
    writeConfig(repoDir, `[scripts\nsetup = broken`)
    writeConfig(userDir, `[scripts]\nsetup = "user-setup"`)
    const cfg = loadRepoConfig(repoDir, userDir, { setupScript: 'db-setup' })
    expect(cfg.errors).toHaveLength(1)
    expect(cfg.errors[0].source).toBe('repo')
    expect(cfg.scripts.setup).toBe('user-setup')
  })

  it('validates run targets: missing command and url+url_command conflicts are errors', () => {
    writeConfig(repoDir, `
[scripts.run.bad]
icon = "play"
[scripts.run.conflicted]
command = "x"
url = "http://a"
url_command = "echo b"
[scripts.run.good]
command = "pnpm db:seed"
`)
    const cfg = loadRepoConfig(repoDir, null, {})
    expect(cfg.errors.map((e) => e.message).join(' ')).toMatch(/bad.*command/)
    expect(cfg.errors).toHaveLength(2)
    expect(cfg.runTargets).toEqual([{ id: 'good', command: 'pnpm db:seed', stop: undefined, url: undefined, urlCommand: undefined, icon: undefined, default: undefined }])
  })
})

describe('legacyRunTargets mapping', () => {
  it('maps previewMode url/script/port onto the default dev target', () => {
    expect(legacyRunTargets({ runCommand: 'pnpm dev', previewMode: 'url', previewValue: 'https://app.test' })[0].url).toBe('https://app.test')
    expect(legacyRunTargets({ runCommand: 'pnpm dev', previewMode: 'script', previewValue: './url.sh' })[0].urlCommand).toBe('./url.sh')
    expect(legacyRunTargets({ runCommand: 'pnpm dev', previewMode: 'port', previewValue: '4000' })[0].url).toBe('http://localhost:4000')
    expect(legacyRunTargets({})).toEqual([])
  })
  it('prefers the typed runTargets JSON column and survives malformed JSON', () => {
    const json = JSON.stringify([{ id: 'stack', command: 'docker compose up', stop: 'docker compose down' }])
    expect(legacyRunTargets({ runTargetsJson: json, runCommand: 'pnpm dev' })[0].id).toBe('stack')
    expect(legacyRunTargets({ runTargetsJson: '{not json', runCommand: 'pnpm dev' })[0].id).toBe('dev')
  })
})
