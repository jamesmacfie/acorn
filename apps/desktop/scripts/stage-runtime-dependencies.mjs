import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { requiredRuntimePackages } from '../../../scripts/nodeRuntimePackages.ts'

function installedPackage(name, require, optional = false) {
  // Resolve directories rather than package.json exports, which some dependencies hide.
  for (const directory of require.resolve.paths(name) ?? []) {
    const candidate = join(directory, name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
  }
  if (optional) return null
  throw new Error(`Runtime package ${name} is not installed.`)
}

// Materialize the installed dependency graph without pnpm symlinks. Tauri's resource walker skips
// directory links, and an installed app cannot resolve into the checkout's virtual store.
export function stageRuntimeDependencies(pkg, helper, names = requiredRuntimePackages) {
  const modules = join(helper, 'node_modules')
  rmSync(modules, { recursive: true, force: true })
  const require = createRequire(join(pkg, 'package.json'))
  const roots = new Map(names.map((name) => [name, installedPackage(name, require)]))
  const copiedRoots = new Set()

  function copyPackage(name, source, directory, ancestors) {
    if (directory === modules) {
      if (copiedRoots.has(name)) return
      copiedRoots.add(name)
    }
    const target = join(directory, name)
    mkdirSync(target, { recursive: true })
    cpSync(source, target, {
      recursive: true,
      dereference: true,
      filter: (path) => path !== join(source, 'node_modules'),
    })
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    const localRequire = createRequire(join(source, 'package.json'))
    const parents = new Map(ancestors)
    parents.set(name, source)
    const dependencies = {
      ...manifest.peerDependencies,
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    }
    for (const dependency of Object.keys(dependencies)) {
      const optional = Object.hasOwn(manifest.optionalDependencies ?? {}, dependency)
        || manifest.peerDependenciesMeta?.[dependency]?.optional === true
      const installed = installedPackage(dependency, localRequire, optional)
      if (!installed || (parents.get(dependency) ?? roots.get(dependency)) === installed) continue
      // Hoist shared packages so NSIS can read their paths within Windows' legacy path limit.
      // A conflicting version stays beside its consumer, where Node resolves it first.
      if (!parents.has(dependency) && !roots.has(dependency)) {
        roots.set(dependency, installed)
        copyPackage(dependency, installed, modules, new Map())
      } else {
        copyPackage(dependency, installed, join(target, 'node_modules'), parents)
      }
    }
  }

  for (const [name, source] of roots) copyPackage(name, source, modules, new Map())
  writeFileSync(resolve(helper, 'package.json'), '{"type":"module"}\n')
  console.log(`[stage] ${names.length} runtime entries, ${roots.size} hoisted packages -> dist/helper/node_modules`)
}
