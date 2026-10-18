import { describe, expect, it } from 'vitest'
import { helpFor, parseCliArgs } from './args'
import { validateCommand } from './commands'

describe('CLI argument contract', () => {
  it('accepts global options before or after the command', () => {
    expect(parseCliArgs(['--node', 'one', 'project', 'list', '--workspace', 'w', '--output', 'json'])).toMatchObject({
      node: 'one',
      output: 'json',
      positionals: ['project', 'list'],
      options: { workspace: 'w' },
    })
    expect(parseCliArgs(['task', 'list', '--status=archived']).options.status).toBe('archived')
  })

  it('rejects unknown or valueless options before connecting', () => {
    expect(() => parseCliArgs(['workspace', 'list', '--mystery'])).toThrow('Unknown option')
    expect(() => parseCliArgs(['--node'])).toThrow('needs a value')
  })

  it('accepts a base branch and requires its value', () => {
    const args = parseCliArgs(['task', 'create', '--project', 'p', '--title', 'Child', '--base', 'feature/parent'])
    expect(args.options.base).toBe('feature/parent')
    expect(() => validateCommand(args)).not.toThrow()
    expect(() => parseCliArgs(['task', 'create', '--base'])).toThrow('needs a value')
    expect(helpFor(['task'])).toContain('[--base BRANCH]')
  })

  it('renders offline help for every built-in level', () => {
    for (const subject of ['node', 'workspace', 'project', 'task', 'plugin']) {
      expect(helpFor([subject])).toContain(`${subject} `)
    }
  })

  it('requires explicit local service intent and refuses remote lifecycle options', () => {
    const check =
      (...argv: string[]) =>
      () =>
        validateCommand(parseCliArgs(argv))
    expect(check('node', 'start')).toThrow('exactly one of --background or --foreground')
    expect(check('node', 'start', '--background', '--foreground')).toThrow('exactly one')
    expect(check('node', 'start', '--background', '--log', 'node.log')).toThrow('--log needs --foreground')
    expect(check('--node', 'remote', 'node', 'stop')).toThrow('local data root')
    expect(check('--node', 'remote', 'node', 'restart')).toThrow('local data root')
    expect(check('node', 'status', '--force')).toThrow('not supported')
    expect(check('node', 'start', '--background')).not.toThrow()
    expect(check('node', 'start', '--foreground', '--log', 'node.log')).not.toThrow()
    expect(check('node', 'stop', '--force')).not.toThrow()
    expect(check('node', 'restart')).not.toThrow()
  })

  it('takes pairing and device commands for any paired Node', () => {
    const check =
      (...argv: string[]) =>
      () =>
        validateCommand(parseCliArgs(argv))
    expect(check('--node', 'remote', 'node', 'pair', '--close')).not.toThrow()
    expect(check('--node', 'remote', 'node', 'devices')).not.toThrow()
    expect(check('node', 'revoke', 'device-one', '--force')).not.toThrow()
    expect(check('node', 'revoke')).toThrow('positional')
    expect(check('node', 'devices', '--close')).toThrow('not supported')
    expect(() => parseCliArgs(['node', 'pair', '--close=yes'])).toThrow('takes no value')
  })
})
