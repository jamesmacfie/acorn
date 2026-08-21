import { createHash, randomUUID } from 'node:crypto'
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { resolveInRoot } from './core/filesystem/confinement'
import { pluginDir, pluginInstallRoot, sweepDebris } from './pluginInstaller'
import { PLUGIN_API_MAJOR, readPluginManifestResult, type PluginManifest } from './pluginManifest'
import {
  markBundledPluginInstalled,
  markPluginUserManaged,
  readBundledPluginState,
} from './bundledPluginState'

export type BundledPluginReconcileResult = {
  installed: string[]
  updated: string[]
  preserved: string[]
  removed: string[]
  failures: Array<{ id: string; reason: string }>
}

const packageFingerprint = (root: string): string => {
  const hash = createHash('sha256')
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      if (entry.isSymbolicLink()) throw new Error(`bundled package contains a symlink (${rel})`)
      if (entry.isDirectory()) {
        hash.update(`d\0${rel}\0`)
        walk(path)
        continue
      }
      if (!entry.isFile()) throw new Error(`bundled package contains an unsupported entry (${rel})`)
      const bytes = readFileSync(path)
      hash.update(`f\0${rel}\0${bytes.byteLength}\0`)
      hash.update(bytes)
    }
  }
  walk(root)
  return hash.digest('hex')
}

const packageManifest = (dir: string, expectedId: string): PluginManifest => {
  // The result form, so a bundled package that fails reconciliation says which field broke rather than
  // "invalid". Same reason the loader uses it (docs/plugins.md § Failures are contained): this sentence
  // is printed at boot and is the only account anyone gets.
  const read = readPluginManifestResult(dir)
  if (!read.ok) throw new Error(read.reason)
  const manifest = read.manifest
  if (manifest.id !== expectedId) throw new Error(`manifest id '${manifest.id}' does not match directory '${expectedId}'`)
  if (manifest.apiVersion !== PLUGIN_API_MAJOR) {
    throw new Error(`built for plugin API ${manifest.apiVersion}; this app speaks ${PLUGIN_API_MAJOR}`)
  }
  for (const declared of [manifest.node, manifest.client, manifest.migrations]) {
    if (!declared) continue
    const path = resolveInRoot(dir, declared)
    if (!path || !existsSync(path)) throw new Error(`declared path '${declared}' is missing or escapes the package`)
  }
  return manifest
}

const place = (dataRoot: string, id: string, source: string): void => {
  const target = pluginDir(dataRoot, id)
  const root = pluginInstallRoot(dataRoot)
  const incoming = join(root, `${id}.incoming-${randomUUID().slice(0, 8)}`)
  cpSync(source, incoming, { recursive: true, errorOnExist: true, force: false })
  const displaced = existsSync(target) ? join(root, `${id}.old-${randomUUID().slice(0, 8)}`) : null
  if (displaced) renameSync(target, displaced)
  try {
    renameSync(incoming, target)
  } catch (error) {
    if (displaced) renameSync(displaced, target)
    rmSync(incoming, { recursive: true, force: true })
    throw error
  }
  if (displaced) rmSync(displaced, { recursive: true, force: true })
}

/** Written by `apps/node/scripts/build-plugin.mjs` into a package it builds straight into the data
 * root, never into `--package-root` staging (docs/plugins.md § Loaded plugins, on why reconciliation
 * needs this marker to tell a developer's own build from an owner-installed package). Re-spelled here
 * rather than imported: the script is plain ESM run by node with no build step, and one filename in
 * two places beats a build dependency between a script and this package. */
export const DEV_BUILD_MARKER = '.acorn-dev-build'

const bundledDirectories = (root: string): string[] => {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => !entry.name.startsWith('.') && entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/** Reconcile trusted app resources into the node-owned plugin directory before the loader scans it.
 * Existing unknown and owner-installed packages win; bytes previously recorded as bundled, and a
 * developer's own `build:plugin` output, are updated. */
export function reconcileBundledPlugins(dataRoot: string, bundledRoot: string): BundledPluginReconcileResult {
  const result: BundledPluginReconcileResult = {
    installed: [], updated: [], preserved: [], removed: [], failures: [],
  }
  sweepDebris(dataRoot)

  for (const id of bundledDirectories(bundledRoot)) {
    try {
      const source = join(bundledRoot, id)
      const manifest = packageManifest(source, id)
      const fingerprint = packageFingerprint(source)
      const target = pluginDir(dataRoot, id)
      const state = readBundledPluginState(dataRoot, id)

      if (state?.status === 'removed') {
        result.removed.push(id)
        continue
      }
      if (state?.status === 'user') {
        result.preserved.push(id)
        continue
      }

      if (existsSync(target)) {
        let targetFingerprint: string | null = null
        try {
          if (lstatSync(target).isDirectory() && statSync(target).isDirectory()) {
            targetFingerprint = packageFingerprint(target)
          }
        } catch {
          // An unreadable or non-directory target is not ours to replace.
        }

        // Covers the crash window after placement but before the state file write, and an owner who
        // happened to install the byte-identical package. Either way these are the app's exact bytes.
        if (targetFingerprint === fingerprint) {
          markBundledPluginInstalled(dataRoot, id, manifest.version, fingerprint, state?.installedAt)
          continue
        }

        // A developer's own `build:plugin` output, treated as app-owned so a newer bundled version
        // wins (docs/plugins.md § Loaded plugins). Checked before the state test rather than only in
        // the no-row case, because the second dev build over an already-reconciled package leaves an
        // 'installed' row whose fingerprint has drifted, which is the same trap one step later.
        // `place` replaces the directory, so the marker goes with it and the package is an ordinary
        // bundled one again until the next build.
        if (existsSync(join(target, DEV_BUILD_MARKER))) {
          place(dataRoot, id, source)
          markBundledPluginInstalled(dataRoot, id, manifest.version, fingerprint, state?.installedAt)
          // Loud, like the loader's built-in-shadowing line, and for the same reason: "the version
          // running is not the one you built" is the single most confusing thing to work out later.
          console.warn(`[plugins] ${id}: replaced a dev build in ${target} with the bundled package from ${source}`)
          result.updated.push(id)
          continue
        }

        if (!state || state.status !== 'installed' || targetFingerprint !== state.fingerprint) {
          markPluginUserManaged(dataRoot, id)
          result.preserved.push(id)
          continue
        }
        place(dataRoot, id, source)
        markBundledPluginInstalled(dataRoot, id, manifest.version, fingerprint, state.installedAt)
        result.updated.push(id)
        continue
      }

      // Removed and user-managed rows returned above. An 'installed' row with no target is an
      // interrupted placement and is safe to retry; no row is a fresh profile.
      place(dataRoot, id, source)
      markBundledPluginInstalled(dataRoot, id, manifest.version, fingerprint, state?.installedAt)
      result.installed.push(id)
    } catch (error) {
      result.failures.push({ id, reason: error instanceof Error ? error.message : String(error) })
    }
  }
  return result
}
