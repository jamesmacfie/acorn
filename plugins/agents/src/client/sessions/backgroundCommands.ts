import type { AgentEventRecord } from '../../contract/wire.ts'
import { toolCardKey } from '../../shared/toolFold'

/**
 * The titles of the session's background commands that are still running, in the order they started,
 * for the header, which stays in view after their cards scroll away
 * (docs/managed-agents/background-commands.md).
 *
 * Its own small fold rather than the transcript's: it keeps three fields per call, so a run that
 * streams output does not concatenate that output again on every event.
 */
export function runningBackgroundCommands(events: readonly AgentEventRecord[]): string[] {
  const calls = new Map<string, { title: string; background: boolean; status: string | undefined }>()
  for (const record of events) {
    if (record.event.type !== 'tool') continue
    const tool = record.event.tool
    const key = toolCardKey(record.turnId, tool.id)
    const known = calls.get(key)
    calls.set(key, {
      title: tool.title || known?.title || 'Command',
      background: Boolean(tool.background || known?.background),
      status: tool.status ?? known?.status,
    })
  }
  return [...calls.values()].filter((call) => call.background && call.status === 'running').map((call) => call.title)
}

/** The last `count` lines of `text`, and how many lines came before them. */
export function lastLines(text: string, count: number): { text: string; hidden: number } {
  const lines = text.replace(/\n$/, '').split('\n')
  if (lines.length <= count) return { text, hidden: 0 }
  return { text: lines.slice(-count).join('\n'), hidden: lines.length - count }
}
