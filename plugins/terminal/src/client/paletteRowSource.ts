import { dispatchLayout, type PaletteItem, type PaletteRowSource, refreshSessions, runApi, setRecipeBrowserUrl, setTerminalOpen } from '@acorn/plugin-api/client'
import { invokeLayoutRecipe, type RecipeSpec } from './recipes'

// What the last `targets` fetch returned, kept so `invoke` can act on the picked row without a
// second request. Keyed by task, and every read of it checks that key.
//
// The targets half is newer than the layout half, and it closes a real bug rather than tidying: the
// layout branch already guarded on `lastLayouts?.taskId === taskId`, but the run branch guarded on
// nothing. It read the target id off the row id and the running flag off `item.running`, a value
// captured when the palette last rendered. A stale "Stop: dev" row, still on screen after switching
// tasks, called `stop` in the new task with the old task's idea of what was running: either stopping
// a target the user did not ask about, or calling `stop` on something that was never started. One
// cache and one key for both branches keeps them from drifting apart again.
let lastTargets: { taskId: string; targets: { id: string; running: boolean }[]; layouts: RecipeSpec[] } | null = null

export const terminalPaletteRowSource: PaletteRowSource = {
  id: 'terminal.run',
  order: 10,
  requires: 'terminal',
  rows: async (taskId) => {
    if (!taskId) return { rows: [] }
    const result = await runApi.targets(taskId)
    if (!('targets' in result)) return { rows: [] }
    lastTargets = { taskId, targets: result.targets.map((t) => ({ id: t.id, running: t.running })), layouts: result.layouts }
    return {
      rows: [
        ...result.targets.map((t): PaletteItem => ({
          kind: 'run',
          id: `run:${t.id}`,
          label: `${t.running ? 'Stop' : 'Run'}: ${t.id}`,
          hint: t.command,
          running: t.running,
        })),
        ...result.layouts.map((l): PaletteItem => ({
          kind: 'layout',
          id: `layout:${l.id}`,
          label: `Layout: ${l.id}`,
          hint: 'open panes + start target',
        })),
      ],
      errors: result.errors,
    }
  },
  invoke: async (item, taskId) => {
    if (!taskId) return
    // Both branches read the cache through this, so neither can act on another task's fetch.
    // Returning null for a mismatched task means the pick is dropped rather than applied to
    // whatever task is open now, the same choice the layout branch already made and the safe one: a
    // run target is repo config, so the same id can exist in two tasks and mean two different
    // commands.
    const cached = lastTargets?.taskId === taskId ? lastTargets : null
    if (item.kind === 'run') {
      const targetId = item.id.slice('run:'.length)
      // `target.running` from the fetch for this task, not `item.running` off the row. The row's
      // flag is as old as the last palette render, so a row left over from another task carries the
      // wrong answer.
      const target = cached?.targets.find((t) => t.id === targetId)
      if (!target) return
      if (target.running) await runApi.stop(taskId, targetId)
      else {
        await runApi.start(taskId, targetId)
        setTerminalOpen(taskId, true)
      }
      await refreshSessions()
      return
    }
    if (item.kind !== 'layout') return
    // Layout recipe: seed panes, auto-start the named target, resolve the browser URL, all through
    // the pure executor, which is why the services are injected rather than imported by it.
    const recipe = cached?.layouts.find((r) => `layout:${r.id}` === item.id)
    if (!recipe) return
    const result = await invokeLayoutRecipe(taskId, recipe, {
      setLayout: (tid, layout) => dispatchLayout(tid, { type: 'replace', layout }),
      startTarget: (tid, targetId) => runApi.start(tid, targetId),
      targetUrl: async (tid, targetId) => (await runApi.status(tid, targetId)).url,
      setBrowserUrl: setRecipeBrowserUrl,
      openTerminal: (tid) => setTerminalOpen(tid, true),
    })
    await refreshSessions()
    return result.ok ? undefined : { error: result.reason }
  },
}
