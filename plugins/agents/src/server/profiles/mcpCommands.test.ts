import { describe, expect, it } from 'vitest'
import { launcherSpec } from '@acorn/plugin-api/node'
import { claudeMcpCommands, codexMcpCommands } from './mcpCommands'

const launcher = launcherSpec('/Applications/acorn.app/Contents/MacOS/node', '/app/helper/mcp.js', 'acorn')

describe('the argv each harness CLI wants (docs/mcp.md — never executed here)', () => {
  it('claude: user-scoped add with the bundled-runtime launcher', () => {
    expect(claudeMcpCommands.add('acorn', launcher)).toEqual({
      file: 'claude',
      args: ['mcp', 'add', '--scope', 'user', 'acorn', '--env', 'ACORN_MCP_NAME=acorn', '--', '/Applications/acorn.app/Contents/MacOS/node', '/app/helper/mcp.js'],
    })
    expect(claudeMcpCommands.remove('acorn-dev')).toEqual({ file: 'claude', args: ['mcp', 'remove', '--scope', 'user', 'acorn-dev'] })
  })
  it('codex: add/remove with the same launcher', () => {
    expect(codexMcpCommands.add('acorn-dev', launcherSpec('/n', '/m.js', 'acorn-dev'))).toEqual({
      file: 'codex',
      args: ['mcp', 'add', 'acorn-dev', '--env', 'ACORN_MCP_NAME=acorn-dev', '--', '/n', '/m.js'],
    })
    expect(codexMcpCommands.remove('acorn-dev')).toEqual({ file: 'codex', args: ['mcp', 'remove', 'acorn-dev'] })
  })
})
