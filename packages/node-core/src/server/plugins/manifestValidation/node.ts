import { NODE_CORE_FACETS } from '../coreFacets'
import { SOURCE_INPUTS_WITH_PROVIDER } from '@acorn/protocol/dataSources.ts'
import type { IssueSink, ManifestInput, ManifestReferences } from './references'

export function validateDependencies(manifest: ManifestInput, ctx: IssueSink): void {
  // These checks compare dependency entries with the package id and each other.
  const required = new Set<string>()
  for (const [index, dependency] of manifest.requires.plugins.entries()) {
    if (dependency.id === manifest.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires', 'plugins', index, 'id'],
        message: 'a plugin cannot require itself',
      })
    }
    if (required.has(dependency.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['requires', 'plugins', index, 'id'],
        message: `'${dependency.id}' is required twice`,
      })
    }
    required.add(dependency.id)
  }
}

export function validateNodeDeclarations(refs: ManifestReferences): void {
  const { manifest, issues: ctx, route } = refs
  const { agentTools, contextSections, cliCommands, browserHandoffs, taskAddresses, browserPanel } =
    manifest.contributions
  agentTools.forEach((entry, i) => route(entry.handler, ['contributions', 'agentTools', i, 'handler']))
  browserHandoffs.forEach((entry, i) => route(entry.resolve, ['contributions', 'browserHandoffs', i, 'resolve']))
  if (taskAddresses !== undefined) route(taskAddresses, ['contributions', 'taskAddresses'])
  if (browserPanel !== undefined) {
    route(browserPanel.route, ['contributions', 'browserPanel', 'route'])
    // Open in Acorn opens this pane on the sidebar's task, so it has to be one that takes a task.
    if (browserPanel.pane !== undefined && !refs.taskPanes.has(browserPanel.pane))
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'browserPanel', 'pane'],
        message: `pane names '${browserPanel.pane}', which this manifest does not declare as a task-scoped pane`,
      })
  }
  contextSections.forEach((entry, i) => route(entry.read, ['contributions', 'contextSections', i, 'read']))
  const changeRequestApi = manifest.contributions.codeHost?.changeRequest?.api
  if (changeRequestApi !== undefined) route(changeRequestApi, ['contributions', 'codeHost', 'changeRequest', 'api'])
  const cliNames = new Set<string>()
  cliCommands.forEach((entry, i) => {
    const at = ['contributions', 'cliCommands', i] as (string | number)[]
    if (manifest.id === 'list')
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: "a plugin named 'list' cannot expose CLI commands because plugin list is built in",
      })
    if (entry.name === 'commands')
      ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: "'commands' is the built-in discovery verb" })
    if (cliNames.has(entry.name))
      ctx.addIssue({ code: 'custom', path: [...at, 'name'], message: `duplicate CLI command '${entry.name}'` })
    cliNames.add(entry.name)
    if (!manifest.node) ctx.addIssue({ code: 'custom', path: at, message: 'a CLI command requires a node entry' })
    if (entry.capability === undefined) return
    if (!(NODE_CORE_FACETS as readonly string[]).includes(entry.capability))
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'capability'],
        message: `unknown core capability '${entry.capability}'`,
      })
    if (!manifest.permissions.node.core.includes(entry.capability))
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'capability'],
        message: `CLI command requires declared core capability '${entry.capability}'`,
      })
  })
  // A code host's data sources get the paths of the projects on its hosts, so the person consents to
  // that the same way they consent to any project read.
  const readsProjects = ['projects:read', 'projects:write', 'projects:config'].some((grant) =>
    manifest.permissions.node.core.includes(grant),
  )
  if (manifest.contributions.codeHost !== undefined && !readsProjects)
    ctx.addIssue({
      code: 'custom',
      path: ['contributions', 'codeHost'],
      message: 'a code host reads the projects on its hosts; declare `projects:read` in permissions.node.core',
    })
  if (!manifest.node) {
    for (const kind of ['dataSources', 'dataSourceDiscoveries'] as const) {
      manifest.contributions[kind]?.forEach((_entry, i) =>
        ctx.addIssue({
          code: 'custom',
          path: ['contributions', kind, i],
          message: 'a data source calls a node route; declare `node` in the manifest',
        }),
      )
    }
    agentTools.forEach((_entry, i) =>
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'agentTools', i],
        message: 'an agent tool calls a node route; declare `node` in the manifest',
      }),
    )
    contextSections.forEach((_entry, i) =>
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'contextSections', i],
        message: 'a context section calls a node route; declare `node` in the manifest',
      }),
    )
    browserHandoffs.forEach((_entry, i) =>
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'browserHandoffs', i],
        message: 'a browser handoff calls a node route; declare `node` in the manifest',
      }),
    )
    if (taskAddresses !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'taskAddresses'],
        message: 'task addresses come from a node route; declare `node` in the manifest',
      })
    if (browserPanel !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'browserPanel'],
        message: 'a browser panel comes from a node route; declare `node` in the manifest',
      })
    // Only a running node half registers its declarations, so a code host without one would claim nothing.
    if (manifest.contributions.codeHost !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'codeHost'],
        message: 'a code host is claimed while the node half runs; declare `node` in the manifest',
      })
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
  manifest.contributions.dataSources?.forEach((entry, i) => {
    // An event feed has no route: the host serves it.
    if ('feed' in entry) return
    route(entry.handler, ['contributions', 'dataSources', i, 'handler'])
    // A derived source reads accounts only through its inputs (../../dataSources/inputs.ts).
    if (entry.inputs && entry.providerId) {
      ctx.addIssue({
        code: 'custom',
        path: ['contributions', 'dataSources', i, 'inputs'],
        message: SOURCE_INPUTS_WITH_PROVIDER,
      })
    }
  })
  manifest.contributions.dataSourceDiscoveries?.forEach((entry, i) =>
    route(entry.handler, ['contributions', 'dataSourceDiscoveries', i, 'handler']),
  )
  schedules.forEach((entry, i) => {
    const at = ['contributions', 'schedules', i] as (string | number)[]
    route(entry.run, [...at, 'run'])
    // Only a node half serves this route; otherwise every scheduled run would fail.
    if (!manifest.node) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: 'a schedule runs a node route; declare `node` in the manifest',
      })
    }
  })
  taskChecks.forEach((entry, i) => {
    const at = ['contributions', 'taskChecks', i] as (string | number)[]
    route(entry.check, [...at, 'check'])
    if (entry.apply !== undefined) route(entry.apply, [...at, 'apply'])
    // Archive checks also need a node half to serve their routes.
    if (!manifest.node) {
      ctx.addIssue({
        code: 'custom',
        path: at,
        message: 'a task check calls a node route; declare `node` in the manifest',
      })
    }
  })
  // A harness needs one executable. Its probes need a node half to serve them.
  harnesses.forEach((entry, i) => {
    const at = ['contributions', 'harnesses', i] as (string | number)[]
    const spawn = entry.spawn
    if ((spawn.command === undefined) === (spawn.entry === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'spawn'],
        message: 'a harness must declare exactly one of command or entry',
      })
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
      ctx.addIssue({
        code: 'custom',
        path: [...at, 'probes'],
        message: 'a harness probe calls a node route; declare `node` in the manifest',
      })
    }
  })
}
