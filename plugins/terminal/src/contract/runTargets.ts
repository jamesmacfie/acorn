// terminal.runTargets — start, stop and observe a repo's run targets as terminal sessions in the
// task's worktree (docs/vNext/plugins.md § Cross-plugin collaboration, which names this as the seam
// preview and workflows need).
//
// Part of the terminal plugin's CONTRACT: id and signature only, nothing executable.
//
// It exists because the RuntimeService is now CONSTRUCTED by the plugin's init — it closes over the
// live session map and the plugin's own database, neither of which the composition root can reach any
// more. Three consumers still need it after init (the agent-tool projection's five run_* tools and the
// workflow runner's `run` step in apps/node/src/wiring/, plus the harness RunBridge, which the plugin
// now fills itself). Publishing it is how they keep working without terminal exporting a second mutable
// module global for the app to reach into.
//
// The signature is the six methods those consumers actually call, restated here so it belongs to the
// provider rather than being defined by RuntimeService's class shape — a contract may not name the
// plugin's internals (tools/arch/boundaries.test.ts).
import { capabilityId } from '@acorn/node-core/server/plugin/capabilities.ts'
import type { LayoutRecipe } from '@acorn/node-core/main/runConfig.ts'
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
