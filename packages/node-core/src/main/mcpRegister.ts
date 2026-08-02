// acorn MCP registration (docs/mcp.md — REUSE-FIRST): register via each agent's OWN mechanism
// (`claude mcp add --scope user`, `codex mcp add`), only ever on explicit user action. acorn never
// writes through into agent config files. Names are build-flavored (acorn / acorn-dev) so dev and
// prod don't clobber each other; register is remove-then-add (idempotent) and removable.
// Pure argv construction (unit tested, execs stubbed) + a thin exec wrapper.
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'

export type AgentFlavour = 'claude' | 'codex'

export const serverName = (isPackaged: boolean): string => (isPackaged ? 'acorn' : 'acorn-dev')

// The Electron-as-node launcher (verne's trick — the user needs no system node): run the bundled
// server entry under the app's own binary with ELECTRON_RUN_AS_NODE=1.
export type Launcher = { command: string; args: string[]; env: Record<string, string> }

export const resolveMcpEntry = (mainOutDir: string): string => join(mainOutDir, 'mcp.js')

// `name` is the build-flavoured server name (serverName above): the MCP server self-reports it
// via ACORN_MCP_NAME, so an `acorn-dev` registration identifies as acorn-dev, not `acorn`.
export const launcherSpec = (electronPath: string, mcpEntry: string, name: string): Launcher => ({
  command: electronPath,
  args: [mcpEntry],
  env: { ELECTRON_RUN_AS_NODE: '1', ACORN_MCP_NAME: name },
})

export type Argv = { file: string; args: string[] }

export function registerArgv(flavour: AgentFlavour, name: string, launcher: Launcher): Argv {
  const envFlags = Object.entries(launcher.env).flatMap(([k, v]) => ['--env', `${k}=${v}`])
  if (flavour === 'claude') {
    // claude mcp add [options] <name> <command> [args...]. `--env` is VARIADIC (`<env...>`), so it
    // must come AFTER <name> — otherwise it swallows the name as an env value ("Invalid environment
    // variable"). `--` then stops it before <command>.
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

// GUI-launched apps (Finder/dock) inherit launchd's minimal PATH (`/usr/bin:/bin:…`) with no
// ~/.local/bin, homebrew or nvm — so `claude`/`codex` aren't found and registration silently fails,
// leaving a stale server path that ENOENTs at `/mcp` time. Run the CLI through a login shell so the
// user's real PATH resolves it. ponytail: login shell is the standard macOS GUI-PATH fix; single-
// quote each arg so paths with spaces survive (`'` → `'\''`).
const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`
const realExec: ExecLike = async (file, args) => {
  const shell = process.env.SHELL || '/bin/sh'
  const cmd = [file, ...args].map(shQuote).join(' ')
  const { stdout } = await promisify(execFile)(shell, ['-lc', cmd], { timeout: 20_000 })
  return { stdout }
}

// Remove-then-add so re-registering never fails on "already exists"; the remove's own failure
// (not registered yet / CLI missing) is ignored — the add's result is the verdict.
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
