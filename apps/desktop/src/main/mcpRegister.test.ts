import { describe, expect, it, vi } from 'vitest'
import { launcherSpec, registerAcornMcp, registerArgv, removeArgv, resolveMcpEntry, serverName } from './mcpRegister'

const launcher = launcherSpec('/Applications/acorn.app/Contents/MacOS/acorn', '/app/out/main/mcp.js', 'acorn')
const devLauncher = launcherSpec('/Applications/acorn.app/Contents/MacOS/acorn', '/app/out/main/mcp.js', 'acorn-dev')

describe('argv construction per agent flavour (docs/next 06 P3 — never executed here)', () => {
  it('claude: user-scoped add with the Electron-as-node launcher', () => {
    expect(registerArgv('claude', 'acorn', launcher)).toEqual({
      file: 'claude',
      args: ['mcp', 'add', '--scope', 'user', 'acorn', '--env', 'ELECTRON_RUN_AS_NODE=1', '--env', 'ACORN_MCP_NAME=acorn', '--', '/Applications/acorn.app/Contents/MacOS/acorn', '/app/out/main/mcp.js'],
    })
    expect(removeArgv('claude', 'acorn-dev')).toEqual({ file: 'claude', args: ['mcp', 'remove', '--scope', 'user', 'acorn-dev'] })
  })
  it('codex: add/remove with the same launcher', () => {
    expect(registerArgv('codex', 'acorn-dev', devLauncher)).toEqual({
      file: 'codex',
      args: ['mcp', 'add', 'acorn-dev', '--env', 'ELECTRON_RUN_AS_NODE=1', '--env', 'ACORN_MCP_NAME=acorn-dev', '--', '/Applications/acorn.app/Contents/MacOS/acorn', '/app/out/main/mcp.js'],
    })
    expect(removeArgv('codex', 'acorn-dev')).toEqual({ file: 'codex', args: ['mcp', 'remove', 'acorn-dev'] })
  })
  it('build-flavored names + launcher path resolution', () => {
    expect(serverName(true)).toBe('acorn')
    expect(serverName(false)).toBe('acorn-dev')
    expect(resolveMcpEntry('/app/out/main')).toBe('/app/out/main/mcp.js')
    // The flavoured name rides the env so the server self-reports correctly (ACORN_MCP_NAME).
    expect(launcher.env).toEqual({ ELECTRON_RUN_AS_NODE: '1', ACORN_MCP_NAME: 'acorn' })
    expect(devLauncher.env.ACORN_MCP_NAME).toBe('acorn-dev')
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
    const res = await registerAcornMcp('claude', 'acorn', launcher, exec)
    expect(res).toEqual({ ok: true })
    expect(calls[0].slice(0, 3)).toEqual(['claude', 'mcp', 'remove'])
    expect(calls[1].slice(0, 3)).toEqual(['claude', 'mcp', 'add'])
  })
  it('missing CLI → clean reason', async () => {
    const exec = vi.fn(async () => {
      throw new Error('spawn codex ENOENT')
    })
    expect(await registerAcornMcp('codex', 'acorn', launcher, exec)).toEqual({ ok: false, reason: "'codex' CLI not found on PATH." })
  })
})
