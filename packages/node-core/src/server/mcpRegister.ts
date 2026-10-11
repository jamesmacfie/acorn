// acorn MCP registration (docs/mcp.md § Configuration). Register through each agent's own mechanism,
// `claude mcp add --scope user` or `codex mcp add`, and only on explicit user action. acorn never
// writes into agent config files. Names are build-flavoured, acorn or acorn-dev, so dev and prod do
// not clobber each other.
//
// Which CLI, and what it wants on its command line, is the harness's own knowledge and is declared
// beside the harness (plugins/agents/src/server/profiles/). What core owns is the shape of the
// exchange: remove, then add, through a login shell, with the failure turned into a sentence.
import { execFile } from 'node:child_process'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { listProfileDefs, type ProfileDef } from './profiles'

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

// The one acorn MCP server this node offers, set by whichever composition root started it, because only
// the root knows the node binary's path and whether this is a packaged build. Read by the two plugins
// that hand it to an agent: terminal, through the CLI's own config file, and agents, over a harness
// protocol that carries MCP declarations (docs/mcp.md § Configuration).
//
// A module singleton rather than a threaded dependency, because it is a property of the process and
// there is exactly one. `null` before the root sets it, and on a standalone node, which receives no
// service handshake and so learns no staging directory.
let configuredMcp: { name: string; launcher: Launcher } | null = null

export const configureAcornMcp = (name: string, launcher: Launcher): void => {
  configuredMcp = { name, launcher }
}

export const acornMcp = (): { name: string; launcher: Launcher } | null => configuredMcp

// The harness bridge program (docs/managed-agents/loop-hooks.md). The build emits it as loop-hook.js
// beside mcp.js, and the same Node runs it, so it is wherever the MCP entry is.
export const acornLoopHook = (): { command: string; args: string[] } | null => {
  const entry = configuredMcp?.launcher.args[0]
  return configuredMcp && entry
    ? { command: configuredMcp.launcher.command, args: [join(dirname(entry), 'loop-hook.js')] }
    : null
}

// The file guard (docs/managed-agents/read-block.md § Claude's own file tools), emitted as
// file-guard.js beside mcp.js like the bridge above. Null on a Node that learned no MCP entry.
export const acornFileGuard = (): { command: string; args: string[] } | null => {
  const entry = configuredMcp?.launcher.args[0]
  return configuredMcp && entry
    ? { command: configuredMcp.launcher.command, args: [join(dirname(entry), 'file-guard.js')] }
    : null
}

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

// The registration lives in the person's own Claude and Codex config, which every checkout shares. An
// isolated `dev:agent` session sets this so its throwaway build doesn't take the `acorn-dev` entry
// over and leave it pointing at a worktree that is later removed.
const registrationAllowed = (): boolean => !process.env.ACORN_SKIP_MCP_REGISTRATION

// Profiles whose registration succeeded this run, so a session spawn can skip the CLI round trip.
const registeredProfiles = new Set<string>()

async function registerProfile(profile: ProfileDef, name: string, launcher: Launcher): Promise<void> {
  try {
    if ((await profile.mcpRegistration?.(name, launcher))?.ok) registeredProfiles.add(profile.id)
  } catch {
    // Not recorded, so the next spawn tries again.
  }
}

// Before a session spawns a harness's CLI, once per profile per run. Failures are swallowed.
export function registerAcornMcpBeforeSpawn(profile: ProfileDef, name: string, launcher: Launcher): void {
  if (!profile.mcpRegistration || !registrationAllowed() || registeredProfiles.has(profile.id)) return
  void registerProfile(profile, name, launcher)
}

// Boot-time re-registration for every profile that declares one (docs/mcp.md § Configuration). Spawn
// already registers; this covers restored and tmux-reattached sessions, which never respawn. Remove
// then add, so it's idempotent, and it never rejects.
export async function refreshAcornMcpRegistrations(name: string, launcher: Launcher): Promise<void> {
  if (!registrationAllowed()) return
  await Promise.all(listProfileDefs().map((profile) => registerProfile(profile, name, launcher)))
}
