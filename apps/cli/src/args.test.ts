import { describe, expect, it } from 'vitest'
import { helpFor, parseCliArgs } from './args'
import { validateCommand } from './commands'

describe('CLI argument contract', () => {
  it('accepts global options before or after the command', () => {
    expect(parseCliArgs(['--node', 'one', 'project', 'list', '--workspace', 'w', '--output', 'json'])).toMatchObject({
      node: 'one', output: 'json', positionals: ['project', 'list'], options: { workspace: 'w' },
    })
    expect(parseCliArgs(['task', 'list', '--status=archived']).options.status).toBe('archived')
  })

  it('rejects unknown or valueless options before connecting', () => {
    expect(() => parseCliArgs(['workspace', 'list', '--mystery'])).toThrow('Unknown option')
    expect(() => parseCliArgs(['--node'])).toThrow('needs a value')
  })

  it('renders offline help for every built-in level', () => {
    for (const subject of ['node', 'workspace', 'project', 'task', 'plugin']) {
      expect(helpFor([subject])).toContain(`${subject} `)
    }
  })

  it('requires explicit local service intent and refuses remote lifecycle options', () => {
    expect(() => validateCommand(parseCliArgs(['node', 'start']))).toThrow('requires --background')
    expect(() => validateCommand(parseCliArgs(['--node', 'remote', 'node', 'stop']))).toThrow('local data root')
    expect(() => validateCommand(parseCliArgs(['node', 'status', '--force']))).toThrow('not supported')
    expect(() => validateCommand(parseCliArgs(['node', 'start', '--background']))).not.toThrow()
    expect(() => validateCommand(parseCliArgs(['node', 'stop', '--force']))).not.toThrow()
  })
})
