// Run-target and layout-recipe palette rows (docs/workflows.md §2, §3).
//
// CommandPalette used to build these itself: it read `runApi.targets()`, mapped the result into rows through
// `composeItems`, and imported this plugin's `invokeLayoutRecipe` to execute a layout pick. The rows and the
// recipe executor are this plugin's; the palette's job is to show a list and dispatch a pick.
//
// `runApi` is client-core's (its routes are `/v2/core/tasks/:id/run*` — core's since Phase 2's scope-shed), so
// nothing here reaches across a plugin boundary; what moved is ownership of the ROWS.
import { runApi } from '@acorn/client-core/tasks/runClient.ts'
import type { PaletteItem } from '@acorn/client-core/palette/model.ts'
import type { PaletteRowSource } from '@acorn/client-core/registries/paletteRows.ts'
import { dispatchLayout, setRecipeBrowserUrl, setTerminalOpen } from '@acorn/client-core/tasks/tasks.ts'
import { refreshSessions } from '@acorn/client-core/tasks/agentSessions.ts'
import { invokeLayoutRecipe, type RecipeSpec } from './recipes'

// The layouts a `targets` fetch also returns, kept so `invoke` can find the picked recipe without a second
// request. Keyed by task, cleared implicitly on the next fetch for that task.
let lastLayouts: { taskId: string; layouts: RecipeSpec[] } | null = null

export const terminalPaletteRowSource: PaletteRowSource = {
  id: 'terminal.run',
  order: 10,
  // Desktop-only: run needs the main-process session engine, so these rows are absent under dev:node rather
  // than present-and-failing. The palette used to guard on `capabilities().terminal` for the whole list.
  requires: 'terminal',
  rows: async (taskId) => {
    if (!taskId) return { rows: [] }
    const result = await runApi.targets(taskId)
    if (!('targets' in result)) return { rows: [] }
    lastLayouts = { taskId, layouts: result.layouts }
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
    if (item.kind === 'run') {
      const targetId = item.id.slice('run:'.length)
      if (item.running) await runApi.stop(taskId, targetId)
      else {
        await runApi.start(taskId, targetId)
        setTerminalOpen(taskId, true)
      }
      await refreshSessions()
      return
    }
    if (item.kind !== 'layout') return
    // Layout recipe: seed panes, auto-start the named target, resolve the browser URL — all through the pure
    // executor, which is why the services are injected rather than imported by it.
    const recipe = lastLayouts?.taskId === taskId ? lastLayouts.layouts.find((r) => `layout:${r.id}` === item.id) : undefined
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
