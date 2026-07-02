// Layout recipes (docs/next 13 §C): a [layout.<id>] config block seeds a TaskLayout, auto-starts
// its named run target in the drawer, and points the browser pane at a target's resolved URL
// (`browser = "run:<id>"`). Pure executor over injected services — unit tested with stubs; the
// palette wires the real runtime/layout/browser glue.
import { isPaneId, type TaskLayout } from './layout'

export type RecipeSpec = {
  id: string
  panes: string[]
  ratio?: number
  terminal?: string // run.<id> to auto-start (shows in the terminal drawer)
  browser?: string // 'run:<id>' — browser home = that target's resolved URL
}

export type RecipeServices = {
  setLayout(taskId: string, layout: TaskLayout): void
  startTarget(taskId: string, targetId: string): Promise<{ ok: boolean; reason?: string }>
  targetUrl(taskId: string, targetId: string): Promise<string | undefined>
  setBrowserUrl(taskId: string, url: string): void
  openTerminal(taskId: string): void
}

// Recipe panes → a validated TaskLayout (1–2 known PaneIds; extras dropped; none valid → null).
export function recipeToLayout(recipe: RecipeSpec): TaskLayout | null {
  const panes = recipe.panes.filter(isPaneId)
  if (!panes.length) return null
  const two = panes.length >= 2 && panes[0] !== panes[1]
  return {
    panes: two ? [panes[0], panes[1]] : [panes[0]],
    ratio: two ? (typeof recipe.ratio === 'number' ? Math.min(0.8, Math.max(0.2, recipe.ratio)) : 0.5) : undefined,
    pinned: null,
    maximised: null,
  }
}

export async function invokeLayoutRecipe(taskId: string, recipe: RecipeSpec, svc: RecipeServices): Promise<{ ok: boolean; reason?: string }> {
  const layout = recipeToLayout(recipe)
  if (!layout) return { ok: false, reason: `layout.${recipe.id} has no valid panes` }
  svc.setLayout(taskId, layout)
  if (recipe.terminal) {
    const res = await svc.startTarget(taskId, recipe.terminal)
    if (!res.ok) return { ok: false, reason: res.reason ?? `could not start '${recipe.terminal}'` }
    svc.openTerminal(taskId)
  }
  if (recipe.browser?.startsWith('run:')) {
    const targetId = recipe.browser.slice('run:'.length)
    // Ensure the target is up so a url_command can resolve; start is idempotent for running ones.
    if (targetId !== recipe.terminal) await svc.startTarget(taskId, targetId)
    const url = await svc.targetUrl(taskId, targetId)
    if (url) svc.setBrowserUrl(taskId, url)
  }
  return { ok: true }
}
