import type { AgentConfigOption } from '../../contract/wire.ts'

/** Why the composer warns, as its warning mark's two tooltip lines. */
export type UnguardedCommandsWarning = { tip: string; detail: string }

// Settings in which a harness runs shell commands with no sandbox and without asking anyone first,
// so a hijacked turn can reach anything the account can. A sandbox or an approval step would each
// stop that, so a mode with either one gets no warning. Claude Code's Auto mode and Codex's automatic
// reviewer still check each command, which is why neither is listed here.
//
// Claude Code reports `bypassPermissions` as its ACP mode. Acorn does not turn on Claude Code's own
// sandbox, so in that mode nothing stands between a command and the account. Codex reports
// `:danger-full-access` as its permission profile, which turns Codex's sandbox off. The unprefixed
// spelling is the same setting's older sandbox-mode name.
const TIP = 'Commands run without a sandbox or approval'
const CODEX_FULL_ACCESS = {
  tip: TIP,
  detail: 'Codex’s full-access profile turns its sandbox off, so its commands can reach everything your account can. Set Permissions to :workspace to sandbox them.',
}
const UNGUARDED: Record<string, UnguardedCommandsWarning> = {
  bypassPermissions: {
    tip: TIP,
    detail: 'Claude Code is skipping permission checks, and its sandbox is off in Acorn sessions, so its commands can reach everything your account can. Set Mode to Auto or Default.',
  },
  ':danger-full-access': CODEX_FULL_ACCESS,
  'danger-full-access': CODEX_FULL_ACCESS,
}

/** The warning for a session whose current settings leave commands unguarded, or undefined. Reads
 *  only what the harness reported, so a harness that reports neither setting never warns. */
export function unguardedCommandsWarning(options: readonly AgentConfigOption[]): UnguardedCommandsWarning | undefined {
  for (const option of options) {
    if (option.category !== 'mode' && option.category !== 'permission') continue
    const warning = option.currentValue ? UNGUARDED[option.currentValue] : undefined
    if (warning) return warning
  }
  return undefined
}
