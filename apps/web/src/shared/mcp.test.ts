import { describe, expect, it } from 'vitest'
import { inspectMcpConfig, maskSecretEnv, MCP_CANDIDATES } from './mcp'

describe('inspectMcpConfig (docs/next 06 A)', () => {
  it('parses the real-world .mcp.json shape (stdio + http)', () => {
    const text = JSON.stringify({
      mcpServers: {
        playwright: { command: 'npx', args: ['@playwright/mcp'] },
        sentry: { type: 'http', url: 'https://mcp.sentry.dev/sse', env: { SENTRY_TOKEN: 'sntrys_abc123456' } },
        broken: 'not-an-object',
      },
    })
    expect(inspectMcpConfig(text)).toEqual([
      { name: 'playwright', transport: 'stdio', status: 'enabled', command: 'npx @playwright/mcp', url: undefined, env: undefined },
      { name: 'sentry', transport: 'http', status: 'enabled', command: undefined, url: 'https://mcp.sentry.dev/sse', env: { SENTRY_TOKEN: 'sntr••••' } },
      { name: 'broken', transport: 'unknown', status: 'invalid' },
    ])
  })
  it('parses cursor-style mcp.servers and honours disabled flags', () => {
    const text = JSON.stringify({ mcp: { servers: { fs: { command: 'mcp-fs', disabled: true } } } })
    expect(inspectMcpConfig(text)[0]).toMatchObject({ name: 'fs', transport: 'stdio', status: 'disabled' })
  })
  it('invalid JSON → a visible invalid row, not a throw; empty/foreign JSON → []', () => {
    expect(inspectMcpConfig('{oops')).toEqual([{ name: '(unparseable config)', transport: 'unknown', status: 'invalid' }])
    expect(inspectMcpConfig('{"otherTool": true}')).toEqual([])
  })
})

describe('maskSecretEnv', () => {
  it('masks by key suffix and by value prefix; keys + non-secrets stay intact', () => {
    expect(
      maskSecretEnv({
        GITHUB_TOKEN: 'ghp_supersecretvalue',
        API_KEY: 'plainlookingvalue',
        OPENAI: 'sk-abc123def',
        SLACK: 'xoxb-12345',
        DEBUG: 'true',
        PORT: 3000,
      }),
    ).toEqual({
      GITHUB_TOKEN: 'ghp_••••',
      API_KEY: 'plai••••',
      OPENAI: 'sk-a••••',
      SLACK: 'xoxb••••',
      DEBUG: 'true',
      PORT: '3000',
    })
  })
})

describe('candidate path allowlist', () => {
  it('only the three known files, scoped to worktree/home roots', () => {
    expect(MCP_CANDIDATES).toEqual([
      { rel: '.mcp.json', root: 'worktree' },
      { rel: '.cursor/mcp.json', root: 'worktree' },
      { rel: '.claude.json', root: 'home' },
    ])
  })
})
