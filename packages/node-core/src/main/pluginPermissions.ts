// Rung 1 of the containment ladder (docs/security.md § Rung 1, permission-shaped context). A loaded
// plugin's NodePluginContext comes from its manifest's `permissions.node` block rather than the full
// context a built-in gets. This is least privilege for cooperative code, not a security boundary: a
// loaded bundle shares the Node process, so it can `import('node:fs')`, open core.sqlite, and ignore
// `ctx` entirely.
import type { CoreServices } from './core'
import type { PrefService } from './core/identity/preferences'
import type { ProjectService } from './core/projects'
import type { CapabilityId, CapabilityRegistry } from '../server/plugin/capabilities'
import type { NodePermissions } from './pluginManifest'
import { MAX_PLUGIN_STATE_BYTES, pluginStateKey } from '@acorn/protocol/pluginState.ts'
import { connectionProviderRegistry } from '../server/integrations/connectionRegistry'

// What `projects:read` grants (docs/security.md § Rung 1, on why `checkouts()` needs its own
// disclosure line in the trust prompt).
const PROJECT_READS = ['byId', 'byGithub', 'checkouts', 'externalProjects'] as const
// Behind its own token because config() and setup() return the shell commands acorn executes. The
// trust assertion sits on the same surface: code with no reason to read project config has no reason
// to assert its trust.
const PROJECT_CONFIG = ['config', 'assertConfigTrusted', 'setup'] as const
const PROJECT_WRITES = ['create', 'update'] as const

// Facet token to CoreServices key, for the facets that map one to one. `secrets` and `proc` are
// absent on purpose: they come from their own manifest booleans, `secrets` and `exec`, because they
// are the two asks a reviewer should see spelled out.
//
// `git` is granted independently of `exec`, and that split is cosmetic. core/vcs/git wraps the same
// runProcess the broker exposes, so `git` without `exec` still means "can run a git subprocess". It
// stays separate because "reads this repo's history" and "runs arbitrary commands" are different
// things to disclose.
const SIMPLE_FACETS = {
  fs: 'fs',
  git: 'git',
  tasks: 'tasks',
  context: 'context',
  models: 'models',
  identity: 'identity',
} as const satisfies Record<string, keyof CoreServices>

// The whole `permissions.node.core` vocabulary, exported as one list so the agent-facing authoring
// projection answers "what may I declare" from the running node rather than a copied list. Derived
// from SIMPLE_FACETS, so a facet added above lands here for free. The four spelled out are the ones
// scopeCore handles itself, and pluginAuthoring.test.ts asserts each still grants something.
export const NODE_CORE_FACETS = [
  ...Object.keys(SIMPLE_FACETS),
  'prefs',
  'projects:read',
  'projects:config',
  'projects:write',
] as const

const pick = <T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> =>
  Object.fromEntries(keys.map((key) => [key, source[key]])) as Pick<T, K>

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).byteLength

// Loaded plugins share the `plugin:<id>:*` preference namespace with their sandboxed frames
// (docs/security.md § Rung 1). Built-ins never pass through scopeCore and keep the raw service,
// because several core-owned preference keys are shared with client surfaces on purpose.
const prefsFor = (prefs: PrefService, pluginId: string): PrefService => ({
  read: (userId, key) => prefs.read(userId, pluginStateKey(pluginId, key)),
  write: async (userId, key, value) => {
    if (utf8Bytes(value) > MAX_PLUGIN_STATE_BYTES) {
      throw new Error(`plugin state values are capped at ${MAX_PLUGIN_STATE_BYTES} bytes`)
    }
    await prefs.write(userId, pluginStateKey(pluginId, key), value)
  },
})

type ProviderOwnership = Pick<typeof connectionProviderRegistry, 'idsForOwner'>

const projectsFor = (
  projects: ProjectService,
  keys: readonly (keyof ProjectService)[],
  pluginId: string,
  providers: ProviderOwnership,
): Partial<ProjectService> => ({
  ...pick(projects, keys),
  // `externalProjects` is the odd project read: each row belongs to an integration provider. Resolve
  // ownership lazily, because providers register during the plugin's init, after this scoped context
  // is built.
  ...(keys.includes('externalProjects')
    ? { externalProjects: (workspaceId: string) => projects.externalProjects(workspaceId, providers.idsForOwner(pluginId)) }
    : {}),
})

// The returned object is typed as a full CoreServices and is not one. Widening
// NodePluginContext['core'] to a partial would make every facet optional for the built-ins that have
// all of them, to describe a shape only loaded plugins see. The lie stops at this one cast, and its
// failure mode, a TypeError on the first call to an undeclared facet, is the point.
export function scopeCore(
  core: CoreServices,
  permissions: NodePermissions,
  pluginId: string,
  providers: ProviderOwnership = connectionProviderRegistry,
): CoreServices {
  const granted: Partial<CoreServices> = {}
  for (const token of permissions.core) {
    if (token === 'prefs') {
      granted.prefs = prefsFor(core.prefs, pluginId)
      continue
    }
    const simple = SIMPLE_FACETS[token as keyof typeof SIMPLE_FACETS]
    if (simple) {
      // Assigning through the union of facet types needs the widening. Each key takes its own value.
      Object.assign(granted, { [simple]: core[simple] })
      continue
    }
    // Both wider project grants imply the reads. A caller that may create or update a project, or
    // read its config, but cannot resolve one by id can do nothing useful.
    if (token === 'projects:read' || token === 'projects:config' || token === 'projects:write') {
      const keys: readonly (keyof ProjectService)[] = token === 'projects:config'
        ? [...PROJECT_READS, ...PROJECT_CONFIG]
        : token === 'projects:write'
          ? [...PROJECT_READS, ...PROJECT_WRITES]
          : PROJECT_READS
      granted.projects = { ...granted.projects, ...projectsFor(core.projects, keys, pluginId, providers) } as ProjectService
    }
    // Anything else is a facet this acorn does not have. Ignored rather than rejected, so a manifest
    // naming a facet from a later build loses that one grant instead of failing to load.
  }
  // Use-scoped credential access. No "read this secret" call exists on the public surface, so this
  // grant cannot widen into one later.
  if (permissions.secrets) granted.secrets = core.secrets
  if (permissions.exec) granted.proc = core.proc
  return granted as CoreServices
}

// An undeclared capability id reads as absent, the same as the providing plugin being disabled,
// which every consumer already degrades around (docs/plugins.md). `require` still throws, because a
// loaded plugin calling `require` on something it never declared is a bug worth being loud about.
//
// `provide` is not filtered. Exporting a capability is a contribution, not an access grant, and the
// host binds nothing to the plugin's name that the plugin could not already publish.
export function scopeCapabilities(
  registry: CapabilityRegistry,
  declared: readonly string[],
): Pick<CapabilityRegistry, 'provide' | 'get' | 'require' | 'ids'> {
  const allowed = new Set(declared)
  return {
    provide: (id, impl) => registry.provide(id, impl),
    get: <T>(id: CapabilityId<T>) => (allowed.has(id) ? registry.get(id) : undefined),
    require: <T>(id: CapabilityId<T>): T => {
      const impl = allowed.has(id) ? registry.get(id) : undefined
      if (impl === undefined) throw new Error(`Required capability not provided: ${id}`)
      return impl
    },
    ids: () => registry.ids().filter((id) => allowed.has(id)),
  }
}
