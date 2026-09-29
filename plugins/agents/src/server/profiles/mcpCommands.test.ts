import { describe, expect, it } from 'vitest'
import { launcherSpec } from '@acorn/plugin-api/node'
import { claudeHandoffMcp, claudeMcpCommands, codexHandoffMcp, codexMcpCommands } from './mcpCommands'

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

// docs/mcp.md § Your own servers. A value never sits on the command line: the flags name a variable and
// the terminal's environment holds it. Both shapes were fed to the real CLIs when this was written:
// `claude --mcp-config` expanded the variable, and `codex mcp list` read the server back.
describe('the flags that carry a session\u2019s servers into a terminal', () => {
  const stdio = { transport: 'stdio' as const, name: 'linear', command: 'npx', args: ['linear-mcp'], env: { LINEAR_API_KEY: 'lin_secret_0123', LOG_LEVEL: 'warn' } }
  const http = { transport: 'http' as const, name: 'docs', url: 'https://docs.example/mcp', headers: { Authorization: 'Bearer tok_0123' } }

  it('claude: one --mcp-config whose values are ${VARIABLES} from the terminal environment', () => {
    const handoff = claudeHandoffMcp([stdio, http])
    expect(handoff.args[0]).toBe('--mcp-config')
    expect(JSON.parse(handoff.args[1]!)).toEqual({ mcpServers: {
      linear: { command: 'npx', args: ['linear-mcp'], env: { LINEAR_API_KEY: '${ACORN_MCP_VALUE_1}', LOG_LEVEL: '${ACORN_MCP_VALUE_2}' } },
      docs: { type: 'http', url: 'https://docs.example/mcp', headers: { Authorization: '${ACORN_MCP_VALUE_3}' } },
    } })
    expect(handoff.env).toEqual({ ACORN_MCP_VALUE_1: 'lin_secret_0123', ACORN_MCP_VALUE_2: 'warn', ACORN_MCP_VALUE_3: 'Bearer tok_0123' })
    expect(handoff.args.join(' ')).not.toContain('secret')
    expect(claudeHandoffMcp([])).toEqual({ args: [], env: {} })
  })

  // Codex forwards a stdio server's environment by name into its own, so only a secret goes that way.
  it('codex: one -c per server, a secret forwarded by name and a plain value inline', () => {
    const handoff = codexHandoffMcp([stdio, http], ['lin_secret_0123', 'Bearer tok_0123'])
    expect(handoff.args).toEqual([
      '-c', 'mcp_servers.linear={command="npx",args=["linear-mcp"],env={"LOG_LEVEL"="warn"},env_vars=["LINEAR_API_KEY"]}',
      '-c', 'mcp_servers.docs={url="https://docs.example/mcp",env_http_headers={"Authorization"="ACORN_MCP_VALUE_2"}}',
    ])
    expect(handoff.env).toEqual({ LINEAR_API_KEY: 'lin_secret_0123', ACORN_MCP_VALUE_2: 'Bearer tok_0123' })
  })

  it('codex: refuses two servers that need different secrets under one name', () => {
    const other = { ...stdio, name: 'linear-work', env: { LINEAR_API_KEY: 'lin_other_4567' } }
    expect(() => codexHandoffMcp([stdio, other], ['lin_secret_0123', 'lin_other_4567'])).toThrow('different values for LINEAR_API_KEY')
  })
})
