import type { ManifestReferences } from './references'
import { isRailMenuLocation } from '@acorn/protocol/contextMenus.ts'

export function validateChrome(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route, action, taskPanes } = refs
  const { sources, slots, contextMenus, commands, keybindings, frames } = manifest.contributions
  sources.forEach((entry, i) => {
    if (entry.items !== undefined) route(entry.items, ['contributions', 'sources', i, 'items'])
    if (entry.tree && !manifest.client) {
      ctx.addIssue({ code: 'custom', path: ['contributions', 'sources', i, 'tree'], message: 'a remote-tree source requires a client bundle' })
    }
    if (entry.onSelect) action(entry.onSelect, ['contributions', 'sources', i, 'onSelect'])
    if (entry.emptyState?.action) action(entry.emptyState.action, ['contributions', 'sources', i, 'emptyState', 'action'])
    // The default pane must belong to this plugin.
    if (entry.defaultPane !== undefined && !taskPanes.has(entry.defaultPane)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'sources', i, 'defaultPane'],
        message: `defaultPane names '${entry.defaultPane}', which this manifest does not declare as a task-scoped pane`,
      })
    }
    // Navigation and a reserved panel both use the space beside a source's rail list.
    if (entry.panels && entry.onSelect?.verb === 'navigate') {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'sources', i, 'panels'],
        message: 'a source cannot reserve a panel region and navigate to a project-scoped surface — both draw beside the rail list',
      })
    }
  })
  slots.forEach((entry, i) => {
    route(entry.data, ['contributions', 'slots', i, 'data'])
    if (entry.onClick) action(entry.onClick, ['contributions', 'slots', i, 'onClick'])
  })
  // Protocol checks the menu fields; this pass checks references in the action.
  contextMenus.forEach((entry, i) => {
    const at = ['contributions', 'contextMenus', i] as (string | number)[]
    if (isRailMenuLocation(entry.location)) {
      const owned = entry.location === 'rail.source'
        ? sources.some((source) => source.id === entry.surface)
        : taskPanes.has(entry.surface ?? '')
      if (!entry.surface || !owned) ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `${entry.location} requires a surface declared by this plugin` })
    } else if (entry.surface !== undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `${entry.location} does not accept a surface` })
    }
    action(entry.action, [...at, 'action'])
  })
  // Each command kind uses a different mix of actions, routes, and choices.
  const commandKind = new Map<string, string>()
  commands.forEach((entry, i) => {
    const at = ['contributions', 'commands', i] as (string | number)[]
    if (!commandKind.has(entry.id)) commandKind.set(entry.id, entry.kind)
    switch (entry.kind) {
      case 'action':
        action(entry.action, [...at, 'action'])
        break
      case 'group':
        break
      case 'search':
        route(entry.route, [...at, 'route'])
        action(entry.onSelect, [...at, 'onSelect'])
        break
      case 'input':
        route(entry.route, [...at, 'route'])
        action(entry.onSuccess, [...at, 'onSuccess'])
        break
      case 'setting': {
        route(entry.readRoute, [...at, 'readRoute'])
        route(entry.writeRoute, [...at, 'writeRoute'])
        // Duplicate values make a returned choice ambiguous.
        const values = new Set<string>()
        entry.options.forEach((option, at2) => {
          if (values.has(option.value)) {
            ctx.addIssue({ code: 'custom', path: [...at, 'options', at2, 'value'], message: `setting '${entry.id}' declares '${option.value}' twice` })
          }
          values.add(option.value)
        })
        break
      }
    }
    // Search, input, and setting commands call routes served by the node half.
    if ((entry.kind === 'search' || entry.kind === 'input' || entry.kind === 'setting') && !manifest.node) {
      const article = entry.kind === 'input' ? 'an' : 'a'
      ctx.addIssue({ code: 'custom', path: at, message: `${article} ${entry.kind} command calls a node route; declare \`node\` in the manifest` })
    }
  })
  // Reject broken command groups at installation. The client also guards older roster rows.
  commands.forEach((entry, i) => {
    if (entry.parentId === undefined) return
    const at = ['contributions', 'commands', i, 'parentId'] as (string | number)[]
    const parent = commandKind.get(entry.parentId)
    if (parent === undefined) {
      ctx.addIssue({ code: 'custom', path: at, message: `command '${entry.id}' names an undeclared parent '${entry.parentId}'` })
      return
    }
    if (parent !== 'group') {
      ctx.addIssue({ code: 'custom', path: at, message: `command '${entry.id}' names '${entry.parentId}', which is not a group` })
      return
    }
    // Walk the short parent chain and report the command that closes a cycle.
    const parents = new Map(commands.map((command) => [command.id, command.parentId]))
    const seen = new Set<string>([entry.id])
    for (let above: string | undefined = entry.parentId; above !== undefined; above = parents.get(above)) {
      if (seen.has(above)) {
        ctx.addIssue({ code: 'custom', path: at, message: `command '${entry.id}' is inside a parent cycle` })
        break
      }
      seen.add(above)
    }
  })
  const commandIds = new Set(commands.map((entry) => entry.id))
  const surfaceIds = new Set(frames.map((frame) => frame.id))
  const boundCommands = new Set<string>()
  keybindings.forEach((entry, i) => {
    const at = ['contributions', 'keybindings', i] as (string | number)[]
    if (!commandIds.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `keybinding names undeclared command '${entry.command}'` })
    }
    if (boundCommands.has(entry.command)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'command'], message: `command '${entry.command}' has more than one keybinding` })
    }
    boundCommands.add(entry.command)
    if (entry.when === 'surface') {
      if (!entry.surface) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is required when a keybinding uses surface scope' })
      } else if (!surfaceIds.has(entry.surface)) {
        ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: `keybinding names undeclared surface '${entry.surface}'` })
      }
    } else if (entry.surface !== undefined) {
      ctx.addIssue({ code: 'custom', path: [...at, 'surface'], message: 'surface is only valid with surface scope' })
    }
  })
}
