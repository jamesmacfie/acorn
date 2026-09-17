// Which harnesses acorn hands its own tool server to, and what the child needs to use it.
// See docs/mcp.md § Configuration for the two doors and why a harness gets one.
import { afterEach, describe, expect, it } from 'vitest'
import { agentProfileRegistry, type AgentProfileContribution } from '@acorn/plugin-api/node'
import { acornMcpServers } from './runtimeEngine'

const mcp = {
  name: 'acorn-dev',
  launcher: { command: '/opt/acorn/node', args: ['/opt/acorn/mcp.js'], env: { ACORN_MCP_NAME: 'acorn-dev' } },
}
const sessionEnv = { ACORN_API_TOKEN: 'signed', ACORN_API_URL: 'https://127.0.0.1:4317' }
const session = (profileId: string) => ({ id: 'session-1', profileId })

const profile = (id: string, extra: Partial<AgentProfileContribution> = {}): (() => void) =>
  agentProfileRegistry.register({
    id,
    label: id,
    kind: 'agent',
    command: id,
    backendPreference: 'tmux',
    transport: 'pty',
    ...extra,
  })

const registered: (() => void)[] = []
afterEach(() => {
  for (const undo of registered.splice(0)) undo()
})

describe('acorn hands a harness its own tool server through one door', () => {
  it('names the server, its argv and the whole launch environment for a protocol-only harness', () => {
    registered.push(profile('deepseek:deepseek'))

    expect(acornMcpServers(mcp, session('deepseek:deepseek'), sessionEnv)).toEqual([{
      name: 'acorn-dev',
      command: '/opt/acorn/node',
      args: ['/opt/acorn/mcp.js'],
      // Spelled out, not inherited: an agent may scrub credential-shaped names out of what it passes
      // its own children, and this server is useless without the token.
      env: {
        ACORN_MCP_NAME: 'acorn-dev',
        ACORN_API_TOKEN: 'signed',
        ACORN_API_URL: 'https://127.0.0.1:4317',
        ACORN_SESSION_ID: 'session-1',
      },
    }])
  })

  it('offers nothing to a harness that registers acorn through its own CLI', () => {
    // Claude Code and Codex both do. Offering it again here would list every acorn tool twice.
    registered.push(profile('claude-code', { mcpRegistration: async () => ({ ok: true }) }))

    expect(acornMcpServers(mcp, session('claude-code'), sessionEnv)).toEqual([])
  })

  it('offers nothing when the node never learned where its own server is', () => {
    // A standalone node receives no service handshake, so it has no staging directory to point at.
    registered.push(profile('deepseek:deepseek'))

    expect(acornMcpServers(null, session('deepseek:deepseek'), sessionEnv)).toEqual([])
  })

  it('offers nothing for a profile that is not registered at all', () => {
    // A broken state rather than a case, and handing a signed token to it is the wrong way to fail.
    expect(acornMcpServers(mcp, session('gone'), sessionEnv)).toEqual([])
  })
})
