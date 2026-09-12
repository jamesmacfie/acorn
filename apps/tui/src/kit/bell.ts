// The sound channel on this host, which is BEL and nothing else
// (docs/notifications.md § The channels).
//
// A Node process has no audio device it can reach portably. BEL is the one sound every terminal
// understands, and Warp, iTerm2 and Kitty already turn it into a badge or an OS notification of
// their own — so what a bell means is the emulator's decision, which is the right place for it.
//
// The switch both channels read moved to ./notify.ts when phase 5 added the OSC half, because the
// platform seam imports that file and may not import this one: this one reaches client-core, which
// reaches the node, and the seam is built before the node is reachable (../platform.ts).
import { registerNoticeSink } from '@acorn/client-core/features/notifications/deliver.ts'
import { BEL, notifyMode, type NotifyMode } from './notify'

export { BEL, notifyMode, type NotifyMode }

/** Ring the terminal for every unseen notice the gate lets through. */
export function initBellNotices(out: NodeJS.WritableStream = process.stdout): () => void {
  const mode = notifyMode()
  if (mode !== 'bell' && mode !== 'both') return () => {}
  return registerNoticeSink(() => { out.write(BEL) })
}
