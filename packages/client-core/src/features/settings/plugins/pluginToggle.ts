import type { NodePluginRow } from '@acorn/protocol/api.ts'

// The one non-obvious computation behind turning a node plugin on or off, split out so it has a test.
//
// A toggle is not "set this row's flag": the route takes the whole disabled list, so ticking one box
// means recomputing the list from the rows currently on screen. Doing that inline in the component
// put the filter/map in a place nothing could exercise, and it has two traps worth pinning: a
// required plugin must never enter the list (the route 400s), and the result must be idempotent,
// because a double-click on a checkbox is one of the easiest things in the world to do.
export function nextDisabledList(rows: readonly NodePluginRow[], name: string, disabled: boolean): string[] {
  const current = rows.filter((row) => row.disabled && !row.required).map((row) => row.name)
  const without = current.filter((candidate) => candidate !== name)
  if (!disabled) return without
  // Refuse rather than silently drop: the caller knows which rows are togglable, so asking to disable
  // a required plugin is a bug in the caller and not a user action to absorb.
  const row = rows.find((candidate) => candidate.name === name)
  if (row?.required) throw new Error(`${name} is a required plugin and cannot be disabled.`)
  return [...without, name]
}
