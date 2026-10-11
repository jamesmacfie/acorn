import { describe, expect, it, vi } from 'vitest'
import { agentProfileRegistry } from './agentProfiles'
import {
  envFlags,
  launcherSpec,
  refreshAcornMcpRegistrations,
  registerAcornMcp,
  registerAcornMcpBeforeSpawn,
  resolveMcpEntry,
  serverName,
  type McpCommands,
} from './mcpRegister'

const launcher = launcherSpec('/Applications/acorn.app/Contents/MacOS/node', '/app/helper/mcp.js', 'acorn')
const devLauncher = launcherSpec('/Applications/acorn.app/Contents/MacOS/node', '/app/helper/mcp.js', 'acorn-dev')

// A stand-in for a harness's declaration. The real ones live beside their harnesses
// (plugins/agents/src/server/profiles/mcpCommands.ts, and its test); core is only meant to run them.
const cli: McpCommands = {
  add: (name, spec) => ({
    file: 'toy',
    args: ['mcp', 'add', name, ...envFlags(spec), '--', spec.command, ...spec.args],
  }),
  remove: (name) => ({ file: 'toy', args: ['mcp', 'remove', name] }),
}

describe('the launcher core hands a harness (docs/mcp.md — never executed here)', () => {
  it('build-flavored names + launcher path resolution', () => {
    expect(serverName(true)).toBe('acorn')
    expect(serverName(false)).toBe('acorn-dev')
    expect(resolveMcpEntry('/app/helper')).toBe('/app/helper/mcp.js')
    // The flavoured name rides the env so the server self-reports correctly (ACORN_MCP_NAME).
    expect(launcher.env).toEqual({ ACORN_MCP_NAME: 'acorn' })
    expect(devLauncher.env.ACORN_MCP_NAME).toBe('acorn-dev')
    expect(envFlags(devLauncher)).toEqual(['--env', 'ACORN_MCP_NAME=acorn-dev'])
  })
})

describe('register/remove round-trip through a stubbed exec', () => {
  it('register = remove-then-add (idempotent); remove failure ignored', async () => {
    const calls: string[][] = []
    const exec = vi.fn(async (file: string, args: string[]) => {
      calls.push([file, ...args])
      if (args[1] === 'remove') throw new Error('No MCP server found with name')
      return { stdout: 'Added stdio MCP server acorn' }
    })
    const res = await registerAcornMcp(cli, 'acorn', launcher, exec)
    expect(res).toEqual({ ok: true })
    expect(calls[0]).toEqual(['toy', 'mcp', 'remove', 'acorn'])
    expect(calls[1]).toEqual([
      'toy',
      'mcp',
      'add',
      'acorn',
      '--env',
      'ACORN_MCP_NAME=acorn',
      '--',
      '/Applications/acorn.app/Contents/MacOS/node',
      '/app/helper/mcp.js',
    ])
  })
  it('missing CLI → a reason naming the command the harness declared', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn toy ENOENT')
    })
    expect(await registerAcornMcp(cli, 'acorn', launcher, exec)).toEqual({
      ok: false,
      reason: "'toy' CLI not found on PATH.",
    })
  })
})

describe('registration bookkeeping shared by boot and spawn', () => {
  it('a spawn skips a profile the boot refresh registered, and retries one that failed', async () => {
    const outcomes = { toy: true, broken: false }
    const register = vi.fn(async (id: 'toy' | 'broken') => ({ ok: outcomes[id] }))
    const profile = (id: 'toy' | 'broken') =>
      ({
        id,
        label: id,
        kind: 'agent',
        command: id,
        backendPreference: 'node-pty',
        transport: 'pty',
        mcpRegistration: () => register(id),
      }) as const
    const undo = [agentProfileRegistry.register(profile('toy')), agentProfileRegistry.register(profile('broken'))]
    try {
      await refreshAcornMcpRegistrations('acorn', launcher)
      expect(register.mock.calls).toEqual([['toy'], ['broken']])

      registerAcornMcpBeforeSpawn(profile('toy'), 'acorn', launcher)
      registerAcornMcpBeforeSpawn(profile('broken'), 'acorn', launcher)
      expect(register.mock.calls).toEqual([['toy'], ['broken'], ['broken']])
    } finally {
      for (const dispose of undo) dispose()
    }
  })
})
