import type { TerminalLaunchContext } from '../contract/launchContext'
import { leadingUtf8 } from './reviewSnapshots'

export async function deliverLaunchContext(
  taskId: string,
  sessionId: string,
  contributors: readonly { id: string; value: TerminalLaunchContext }[],
  send: (sessionId: string, text: string) => void,
  warn: (message: string) => void,
): Promise<void> {
  let remainingBytes = 16_384
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
