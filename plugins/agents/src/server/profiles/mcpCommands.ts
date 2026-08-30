// What each harness's CLI wants on its command line to gain or lose an MCP server. Core runs these
// (node-core/server/mcpRegister.ts); it no longer knows either CLI by name.
import { envFlags, type Argv, type Launcher, type McpCommands } from '@acorn/plugin-api/node'

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
