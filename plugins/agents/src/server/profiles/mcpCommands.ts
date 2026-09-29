// What each harness's CLI wants on its command line to gain or lose an MCP server. Core runs these
// (node-core/server/mcpRegister.ts); it no longer knows either CLI by name.
import { envFlags, type Argv, type Launcher, type McpCommands } from '@acorn/plugin-api/node'
import type { AgentDriverMcpServer } from '../drivers/types'

// claude mcp add [options] <name> <command> [args...]. `--env` is variadic, so it has to come after
// <name> or it swallows the name as an env value ("Invalid environment variable"). `--` then stops it
// before <command>.
export const claudeMcpCommands: McpCommands = {
  add: (name: string, launcher: Launcher): Argv => ({
    file: 'claude',
    args: ['mcp', 'add', '--scope', 'user', name, ...envFlags(launcher), '--', launcher.command, ...launcher.args],
  }),
  remove: (name: string): Argv => ({ file: 'claude', args: ['mcp', 'remove', '--scope', 'user', name] }),
}

// codex mcp add <name> [--env KEY=VAL] -- <command> [args...]
export const codexMcpCommands: McpCommands = {
  add: (name: string, launcher: Launcher): Argv => ({
    file: 'codex',
    args: ['mcp', 'add', name, ...envFlags(launcher), '--', launcher.command, ...launcher.args],
  }),
  remove: (name: string): Argv => ({ file: 'codex', args: ['mcp', 'remove', name] }),
}

/** The flags that hand a terminal session its MCP servers, and the environment they read values from. */
export type HandoffMcp = { args: string[]; env: Record<string, string> }

// The terminal handoff (docs/mcp.md § Your own servers). A harness keeps no servers between
// processes, so `--resume` in a terminal would start without them. Every value goes through the
// terminal's environment and the command line only names it, because a command line is readable in
// `ps` by every user on the machine. The terminal passes that environment the way it passes acorn's
// own token (plugins/terminal/src/server/terminalUtils.ts).

// Claude Code expands `${NAME}` in an `--mcp-config` value from its own environment, so each value
// gets a variable of acorn's choosing and nothing can collide.
export function claudeHandoffMcp(servers: readonly AgentDriverMcpServer[]): HandoffMcp {
  if (!servers.length) return { args: [], env: {} }
  const env: Record<string, string> = {}
  const named = (values: Record<string, string>) => Object.fromEntries(Object.entries(values).map(([key, value]) => {
    const variable = `ACORN_MCP_VALUE_${Object.keys(env).length + 1}`
    env[variable] = value
    return [key, `\${${variable}}`]
  }))
  const mcpServers = Object.fromEntries(servers.map((server) => [
    server.name,
    server.transport === 'stdio'
      ? { command: server.command, args: server.args, env: named(server.env) }
      : { type: 'http', url: server.url, headers: named(server.headers) },
  ]))
  return { args: ['--mcp-config', JSON.stringify({ mcpServers })], env }
}

// Codex takes one `-c` per server, as a TOML inline table. A header value can come from any variable
// (`env_http_headers`). A stdio server's environment cannot: Codex forwards it by name (`env_vars`),
// so a forwarded value also lands in the environment Codex itself runs in. Only the secrets go that
// way. Everything else is written inline, so a server that sets PATH or NODE_OPTIONS does not change
// the terminal around it. Two servers that need different secrets under one name cannot both have
// it, and that is refused rather than letting one quietly run with the other's value.
export function codexHandoffMcp(servers: readonly AgentDriverMcpServer[], secrets: readonly string[]): HandoffMcp {
  const secret = new Set(secrets)
  const env: Record<string, string> = {}
  const claimedBy = new Map<string, string>()
  // A JSON string literal is also a valid TOML basic string, which is what makes this safe to build.
  const toml = (value: string) => JSON.stringify(value)
  const list = (values: readonly string[]) => `[${values.map(toml).join(',')}]`
  const table = (entries: ReadonlyArray<[string, string]>) => `{${entries.map(([key, value]) => `${toml(key)}=${toml(value)}`).join(',')}}`
  const args = servers.flatMap((server) => {
    if (server.transport === 'http') {
      const headers = Object.entries(server.headers).map(([header, value]): [string, string] => {
        const variable = `ACORN_MCP_VALUE_${Object.keys(env).length + 1}`
        env[variable] = value
        return [header, variable]
      })
      return ['-c', `mcp_servers.${server.name}={url=${toml(server.url)},env_http_headers=${table(headers)}}`]
    }
    const inline: Array<[string, string]> = []
    const forwarded: string[] = []
    for (const [name, value] of Object.entries(server.env)) {
      if (!secret.has(value)) {
        inline.push([name, value])
        continue
      }
      const owner = claimedBy.get(name)
      if (owner !== undefined && env[name] !== value) {
        throw new Error(`Codex cannot give ${owner} and ${server.name} different values for ${name} in a terminal. Switch one of them off for this session first.`)
      }
      claimedBy.set(name, server.name)
      env[name] = value
      forwarded.push(name)
    }
    return ['-c', `mcp_servers.${server.name}={command=${toml(server.command)},args=${list(server.args)},env=${table(inline)},env_vars=${list(forwarded)}}`]
  })
  return { args, env }
}
