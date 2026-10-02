import type { TerminalLaunchContext } from '../contract/launchContext'
import { leadingUtf8 } from './reviewSnapshots'

export async function deliverLaunchContext(
  taskId: string,
  sessionId: string,
  contributors: readonly { id: string; value: TerminalLaunchContext }[],
  send: (sessionId: string, text: string) => void,
  warn: (message: string) => void,
): Promise<void> {
  let remainingBytes = 262_144
  for (const contributor of contributors) {
    if (remainingBytes <= 0) break
    try {
      const block = await contributor.value.read(taskId)
      if (!block?.trim()) continue
      const bounded = leadingUtf8(block, remainingBytes)
      if (!bounded) continue
      send(sessionId, bounded)
      remainingBytes -= Buffer.byteLength(bounded, 'utf8')
    } catch (error) {
      warn(`launch context from ${contributor.id} failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

// System-prompt profiles get the complete standing block before the PTY starts.
export async function readLaunchContext(taskId: string, contributors: readonly { id: string; value: TerminalLaunchContext }[], warn: (message: string) => void): Promise<string | null> {
  const blocks: string[] = []
  for (const contributor of contributors) {
    try {
      const text = await contributor.value.read(taskId)
      if (text?.trim()) blocks.push(text)
    } catch (error) { warn(`launch context from ${contributor.id} failed: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return blocks.join('\n\n') || null
}
