// acorn MCP registration (docs/mcp.md § Configuration). Register through each agent's own mechanism,
// `claude mcp add --scope user` or `codex mcp add`, and only on explicit user action. acorn never
// writes into agent config files. Names are build-flavoured, acorn or acorn-dev, so dev and prod do
// not clobber each other.
//
// Which CLI, and what it wants on its command line, is the harness's own knowledge and is declared
// beside the harness (plugins/agents/src/server/profiles/). What core owns is the shape of the
// exchange: remove, then add, through a login shell, with the failure turned into a sentence.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

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

// The two command lines a harness declares. `add` is given the launcher because every CLI spells the
// command, its arguments and its environment differently; `remove` needs only the server name.
export type McpCommands = {
  add: (name: string, launcher: Launcher) => Argv
  remove: (name: string) => Argv
}

// `--env KEY=VAL` pairs, which is the spelling both CLIs that ship with acorn happen to share. Offered
// rather than imposed: a harness whose CLI wants something else builds its own argv.
export const envFlags = (launcher: Launcher): string[] =>
  Object.entries(launcher.env).flatMap(([key, value]) => ['--env', `${key}=${value}`])

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
  commands: McpCommands,
  name: string,
  launcher: Launcher,
  exec: ExecLike = realExec,
): Promise<{ ok: boolean; reason?: string }> {
  const remove = commands.remove(name)
  await exec(remove.file, remove.args).catch(() => undefined)
  const add = commands.add(name, launcher)
  try {
    await exec(add.file, add.args)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, reason: msg.includes('ENOENT') ? `'${add.file}' CLI not found on PATH.` : msg.slice(0, 300) }
  }
}
