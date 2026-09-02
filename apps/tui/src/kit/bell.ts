// The sound channel on this host, which is BEL and nothing else
// (docs/future/notifications/phase-3-sound.md).
//
// A Node process has no audio device it can reach portably. BEL is the one sound every terminal
// understands, and Warp, iTerm2 and Kitty already turn it into a badge or an OS notification of
// their own — so what a bell means is the emulator's decision, which is the right place for it.
import { registerNoticeSink } from '@acorn/client-core/features/notifications/deliver.ts'

/** `off`, `bell`, `terminal`, or `both`, the same shape as `ACORN_TUI_OSC52`. There is no device
 *  preference store here, so the environment is the switch. Anything unrecognised reads as `both`,
 *  which is the default. `terminal` is phase 5's OSC sequences. */
export type NotifyMode = 'off' | 'bell' | 'terminal' | 'both'

export function notifyMode(env: NodeJS.ProcessEnv = process.env): NotifyMode {
  const mode = env.ACORN_TUI_NOTIFY
  return mode === 'off' || mode === 'bell' || mode === 'terminal' ? mode : 'both'
}

export const BEL = '\u0007'

/** Ring the terminal for every unseen notice the gate lets through. */
export function initBellNotices(out: NodeJS.WritableStream = process.stdout): () => void {
  const mode = notifyMode()
  if (mode !== 'bell' && mode !== 'both') return () => {}
  return registerNoticeSink(() => { out.write(BEL) })
}
