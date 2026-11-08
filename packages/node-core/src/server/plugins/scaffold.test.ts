import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginScaffoldRequest } from '@acorn/protocol/api.ts'
import { testScaffoldPackage } from '../../testkit/scaffoldPackage'
import { scaffoldRequest, writePluginScaffold } from './scaffold'

const scratch = () => mkdtempSync(join(tmpdir(), 'acorn-scaffold-'))
const pane = (folder: string, git = false): PluginScaffoldRequest => ({
  folder,
  pluginId: 'weather',
  name: 'Weather',
  kind: 'pane',
  git,
})
const write = (request: PluginScaffoldRequest) => writePluginScaffold(testScaffoldPackage, request)
const parse = (body: unknown) => scaffoldRequest(testScaffoldPackage).safeParse(body)

// A git config of the test's own, so the outcome doesn't depend on the machine's identity.
const gitConfig = (text: string) => {
  const file = join(scratch(), 'gitconfig')
  writeFileSync(file, text)
  vi.stubEnv('GIT_CONFIG_GLOBAL', file)
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
}
const lastCommit = (folder: string) =>
  execFileSync('git', ['log', '--format=%an <%ae>|%s'], { cwd: folder, encoding: 'utf8' }).trim().split('\n')

afterEach(() => vi.unstubAllEnvs())

describe('the scaffold request', () => {
  it('accepts each kind', () => {
    expect(parse(pane('/tmp/a')).success).toBe(true)
    expect(parse({ ...pane('/tmp/a'), kind: 'trigger' }).success).toBe(true)
    const dataSource = { row: 'An invoice', inputs: [{ source: 'github:pulls' }] }
    expect(parse({ ...pane('/tmp/a'), kind: 'data-source', dataSource }).success).toBe(true)
  })

  it('refuses a relative folder', () => {
    expect(parse(pane('plugins/weather')).success).toBe(false)
  })

  it('refuses an ID the scaffold would change', () => {
    for (const pluginId of ['Weather', 'my plugin', 'w'])
      expect(parse({ ...pane('/tmp/a'), pluginId }).success).toBe(false)
  })

  it('refuses a data source without its starter, or with a first input that is optional', () => {
    expect(parse({ ...pane('/tmp/a'), kind: 'data-source' }).success).toBe(false)
    const optionalFirst = { row: 'A row', inputs: [{ source: 'github:pulls', optional: true }] }
    expect(parse({ ...pane('/tmp/a'), kind: 'data-source', dataSource: optionalFirst }).success).toBe(false)
    expect(parse({ ...pane('/tmp/a'), kind: 'data-source', dataSource: { row: 'A row', inputs: [] } }).success).toBe(
      false,
    )
  })
})

describe('writePluginScaffold', () => {
  it('creates a missing folder and writes the starter files', async () => {
    const folder = join(scratch(), 'weather')
    expect(await write(pane(folder))).toEqual({ result: 'written', git: 'off' })
    expect(readdirSync(folder).sort()).toEqual(['acorn-plugin.json', 'client.js', 'node'])
    expect(JSON.parse(readFileSync(join(folder, 'acorn-plugin.json'), 'utf8'))).toEqual({
      id: 'weather',
      name: 'Weather',
    })
    expect(readFileSync(join(folder, 'client.js'), 'utf8')).toBe('// pane\n')
  })

  it('writes into an empty folder', async () => {
    const folder = scratch()
    expect(await write(pane(folder))).toEqual({ result: 'written', git: 'off' })
  })

  it('refuses a folder with anything in it and leaves it alone', async () => {
    const folder = scratch()
    writeFileSync(join(folder, '.keep'), 'mine')
    expect(await write(pane(folder))).toBe('not-empty')
    expect(readdirSync(folder)).toEqual(['.keep'])
  })

  it('passes the kind through to the scaffold', async () => {
    const trigger = join(scratch(), 'trigger')
    await write({ ...pane(trigger), kind: 'trigger' })
    expect(readFileSync(join(trigger, 'client.js'), 'utf8')).toBe('// trigger\n')
    const source = join(scratch(), 'source')
    await write({
      ...pane(source),
      kind: 'data-source',
      dataSource: { row: 'An invoice', inputs: [{ source: 'a:b' }] },
    })
    expect(readFileSync(join(source, 'node/index.js'), 'utf8')).toBe('// data source: An invoice\n')
  })

  it('commits the starter files as the node when it has a git identity', async () => {
    gitConfig('[user]\n\tname = Owner\n\temail = owner@example.test\n')
    const folder = join(scratch(), 'weather')
    expect(await write(pane(folder, true))).toEqual({ result: 'written', git: 'committed' })
    expect(lastCommit(folder)).toEqual(['Owner <owner@example.test>|Start Weather from the plugin scaffold'])
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: folder, encoding: 'utf8' })).toBe('')
  })

  it('commits as Acorn when the node has no git identity', async () => {
    // `useConfigOnly` stops git guessing a name from the machine, as a node with no ~/.gitconfig can't.
    gitConfig('[user]\n\tuseConfigOnly = true\n')
    const folder = join(scratch(), 'weather')
    expect(await write(pane(folder, true))).toEqual({ result: 'written', git: 'committed' })
    expect(lastCommit(folder)).toEqual(['Acorn <acorn@localhost>|Start Weather from the plugin scaffold'])
  })

  it('keeps the files and says why when git fails', async () => {
    vi.stubEnv('PATH', join(scratch(), 'no-git-here'))
    const folder = join(scratch(), 'weather')
    const result = await write(pane(folder, true))
    expect(result).toMatchObject({ result: 'written', git: { skipped: expect.stringContaining('git') } })
    expect(readdirSync(folder)).toContain('acorn-plugin.json')
  })

  it('leaves a folder alone when git is off', async () => {
    const folder = join(scratch(), 'weather')
    mkdirSync(folder)
    await write(pane(folder))
    expect(readdirSync(folder)).not.toContain('.git')
  })
})
