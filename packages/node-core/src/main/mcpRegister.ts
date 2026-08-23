// acorn MCP registration (docs/mcp.md § Configuration). Register through each agent's own mechanism,
// `claude mcp add --scope user` or `codex mcp add`, and only on explicit user action. acorn never
// writes into agent config files. Names are build-flavoured, acorn or acorn-dev, so dev and prod do
// not clobber each other.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

export type AgentFlavour = 'claude' | 'codex'

export const serverName = (isPackaged: boolean): string => (isPackaged ? 'acorn' : 'acorn-dev')

// The MCP server runs under the Node the app ships, so the user needs no system install.
export type Launcher = { command: string; args: string[]; env: Record<string, string> }

export const resolveMcpEntry = (stagingDir: string): string => join(stagingDir, 'mcp.js')

// `name` is the build-flavoured server name from `serverName`. The MCP server self-reports it
// through ACORN_MCP_NAME, so an `acorn-dev` registration identifies as acorn-dev.
export const launcherSpec = (hostRuntimePath: string, mcpEntry: string, name: string): Launcher => ({
  command: hostRuntimePath,
  args: [mcpEntry],
  env: { ACORN_MCP_NAME: name },
})

export type Argv = { file: string; args: string[] }

export function registerArgv(flavour: AgentFlavour, name: string, launcher: Launcher): Argv {
  const envFlags = Object.entries(launcher.env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  if (flavour === 'claude') {
    // claude mcp add [options] <name> <command> [args...]. `--env` is variadic, so it has to come
    // after <name> or it swallows the name as an env value ("Invalid environment variable"). `--`
    // then stops it before <command>.
    return { file: 'claude', args: ['mcp', 'add', '--scope', 'user', name, ...envFlags, '--', launcher.command, ...launcher.args] }
  }
  // codex mcp add <name> [--env KEY=VAL] -- <command> [args...]
  return { file: 'codex', args: ['mcp', 'add', name, ...envFlags, '--', launcher.command, ...launcher.args] }
}

export function removeArgv(flavour: AgentFlavour, name: string): Argv {
  if (flavour === 'claude') return { file: 'claude', args: ['mcp', 'remove', '--scope', 'user', name] }
  return { file: 'codex', args: ['mcp', 'remove', name] }
}

export type ExecLike = (file: string, args: string[]) => Promise<{ stdout: string }>

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const realExec: ExecLike = async (file, args) => {
  const shell = process.env.SHELL || '/bin/sh'
  const cmd = [file, ...args].map(shQuote).join(' ')
  const { stdout } = await promisify(execFile)(shell, ['-lc', cmd], { timeout: 20_000 })
  return { stdout }
}

// Remove-then-add, so re-registering never fails on "already exists". The remove's own failure is
// ignored, because it means the server was not registered or the CLI is missing. The add decides.
export async function registerAcornMcp(
  flavour: AgentFlavour,
  name: string,
  launcher: Launcher,
  exec: ExecLike = realExec,
): Promise<{ ok: boolean; reason?: string }> {
  const remove = removeArgv(flavour, name)
  await exec(remove.file, remove.args).catch(() => undefined)
  const add = registerArgv(flavour, name, launcher)
  try {
    await exec(add.file, add.args)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg.includes('ENOENT') ? `'${flavour}' CLI not found on PATH.` : msg.slice(0, 300) }
  }
}
