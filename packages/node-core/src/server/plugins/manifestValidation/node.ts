import { NODE_CORE_FACETS } from '../coreFacets'
import type { IssueSink, ManifestInput, ManifestReferences } from './references'

export function validateDependencies(manifest: ManifestInput, ctx: IssueSink): void {
  // These checks compare dependency entries with the package id and each other.
  const required = new Set<string>()
  for (const [index, dependency] of manifest.requires.plugins.entries()) {
    if (dependency.id === manifest.id) {
      ctx.addIssue({ code: 'custom', path: ['requires', 'plugins', index, 'id'], message: 'a plugin cannot require itself' })
    }
    if (required.has(dependency.id)) {
      ctx.addIssue({ code: 'custom', path: ['requires', 'plugins', index, 'id'], message: `'${dependency.id}' is required twice` })
    }
    required.add(dependency.id)
  }
}

export function validateNodeDeclarations(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route } = refs
  const { agentTools, contextSections, cliCommands } = manifest.contributions
  agentTools.forEach((entry, i) => route(entry.handler, ['contributions', 'agentTools', i, 'handler']))
  contextSections.forEach((entry, i) => route(entry.read, ['contributions', 'contextSections', i, 'read']))
  const cliNames = new Set<string>()
  cliCommands.forEach((entry, i) => {
    const at = ['contributions', 'cliCommands', i] as (string | number)[]
    if (manifest.id === 'list') ctx.addIssue({ code: 'custom', path: at, message: "a plugin named 'list' cannot expose CLI commands because plugin list is built in" })
    if (entry.name === 'commands') ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: "'commands' is the built-in discovery verb" })
    if (cliNames.has(entry.name)) ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: `duplicate CLI command '${entry.name}'` })
    cliNames.add(entry.name)
    if (!manifest.node) ctx.addIssue({ code: 'custom', path: at, message: 'a CLI command requires a node entry' })
    if (!(NODE_CORE_FACETS as readonly string[]).includes(entry.capability)) ctx.addIssue({ code: 'custom', path: [...at, 'capability'], message: `unknown core capability '${entry.capability}'` })
    if (!manifest.permissions.node.core.includes(entry.capability)) ctx.addIssue({ code: 'custom', path: [...at, 'capability'], message: `CLI command requires declared core capability '${entry.capability}'` })
  })
  if (!manifest.node) {
    for (const kind of ['dataSources', 'dataSourceDiscoveries'] as const) {
      manifest.contributions[kind]?.forEach((_entry, i) => ctx.addIssue({
        code: 'custom', path: ['contributions', kind, i],
        message: 'a data source calls a node route; declare `node` in the manifest',
      }))
    }
    agentTools.forEach((_entry, i) => ctx.addIssue({
      code: 'custom', path: ['contributions', 'agentTools', i],
      message: 'an agent tool calls a node route; declare `node` in the manifest',
    }))
    contextSections.forEach((_entry, i) => ctx.addIssue({
      code: 'custom', path: ['contributions', 'contextSections', i],
      message: 'a context section calls a node route; declare `node` in the manifest',
    }))
  }
}

export function validateRuntimeContributions(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route } = refs
  const { attention, nodeStats, agentContexts, refResolvers, schedules, taskChecks, harnesses } = manifest.contributions
  attention.forEach((entry, i) => route(entry.items, ['contributions', 'attention', i, 'items']))
  nodeStats.forEach((entry, i) => route(entry.data, ['contributions', 'nodeStats', i, 'data']))
  agentContexts.forEach((entry, i) => {
    route(entry.options, ['contributions', 'agentContexts', i, 'options'])
    route(entry.capture, ['contributions', 'agentContexts', i, 'capture'])
  })
  refResolvers.forEach((entry, i) => route(entry.resolve, ['contributions', 'refResolvers', i, 'resolve']))
  manifest.contributions.dataSources?.forEach((entry, i) => route(entry.handler, ['contributions', 'dataSources', i, 'handler']))
  manifest.contributions.dataSourceDiscoveries?.forEach((entry, i) => route(entry.handler, ['contributions', 'dataSourceDiscoveries', i, 'handler']))
  schedules.forEach((entry, i) => {
    const at = ['contributions', 'schedules', i] as (string | number)[]
    route(entry.run, [...at, 'run'])
    // Only a node half serves this route; otherwise every scheduled run would fail.
    if (!manifest.node) {
      ctx.addIssue({ code: 'custom', path: at, message: 'a schedule runs a node route; declare `node` in the manifest' })
    }
  })
  taskChecks.forEach((entry, i) => {
    const at = ['contributions', 'taskChecks', i] as (string | number)[]
    route(entry.check, [...at, 'check'])
    if (entry.apply !== undefined) route(entry.apply, [...at, 'apply'])
    // Archive checks also need a node half to serve their routes.
    if (!manifest.node) {
      ctx.addIssue({ code: 'custom', path: at, message: 'a task check calls a node route; declare `node` in the manifest' })
    }
  })
  // A harness needs one executable. Its probes need a node half to serve them.
  harnesses.forEach((entry, i) => {
    const at = ['contributions', 'harnesses', i] as (string | number)[]
    const spawn = entry.spawn
    if ((spawn.command === undefined) === (spawn.entry === undefined)) {
      ctx.addIssue({ code: 'custom', path: [...at, 'spawn'], message: 'a harness must declare exactly one of command or entry' })
    }
    if (spawn.requires !== undefined && spawn.entry === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'spawn', 'requires'],
        message: 'requires names the CLI an adapter drives, so it is only valid with entry',
      })
    }
    // One-shot and terminal modes must resolve to the same command.
    if (entry.oneShot !== undefined && entry.oneShot.command === undefined && entry.terminal === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'oneShot', 'command'],
        message: 'a one-shot turn needs a command, either its own or the one terminal declares',
      })
    }
    if (entry.oneShot?.command !== undefined && entry.terminal !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'oneShot', 'command'],
        message: 'a harness runs one command; oneShot borrows the one terminal declares',
      })
    }
    if (entry.probes?.usage !== undefined) route(entry.probes.usage, [...at, 'probes', 'usage'])
    if (entry.probes?.auth !== undefined) route(entry.probes.auth, [...at, 'probes', 'auth'])
    // A probe on a descriptor-only package would fail on every refresh.
    if (entry.probes && !manifest.node) {
      ctx.addIssue({ code: 'custom', path: [...at, 'probes'], message: 'a harness probe calls a node route; declare `node` in the manifest' })
    }
  })
}
