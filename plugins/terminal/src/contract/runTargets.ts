import { capabilityId, type LayoutRecipe } from '@acorn/plugin-api/node'
import type { RunStatus, RunTargetInfo } from '@acorn/protocol/terminal.ts'

// `{ error }` rather than a throw, on every read: a repo with no mapped checkout or an unparseable
// `.acorn/config.toml` is an ordinary state the palette and the run pane render as a row, not an
// exception.
export type TerminalRunTargets = {
  targets(taskId: string): Promise<{ targets: RunTargetInfo[]; errors: { source: string; message: string }[]; layouts: LayoutRecipe[] } | { error: string }>
  start(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string; sessionId?: string }>
  stop(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string }>
  restart(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string; sessionId?: string }>
  status(taskId: string, targetId: string): Promise<RunStatus>
  // The default target's URL, for the browser/preview home.
  defaultUrl(taskId: string): Promise<string | undefined>
}

export const TERMINAL_RUN_TARGETS = capabilityId<TerminalRunTargets>('terminal.runTargets')
