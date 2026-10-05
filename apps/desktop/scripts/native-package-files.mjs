import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { runtimeTarget } from './node-runtime.mjs'

// node-pty 1.1.0 loads build/Release, build/Debug, then prebuilds/<platform>-<arch>.
// Keep the selected prebuild directory whole: Windows can load ConPTY or winpty,
// including the DLLs and executables beside their addons.
export function nativePackageFilter(name, source, target) {
  if (name !== 'node-pty') return () => true
  const selected = runtimeTarget(target.triple)
  if (selected.platform !== target.platform || selected.arch !== target.arch) {
    throw new Error(`Invalid desktop target descriptor for ${target.triple}`)
  }
  const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
  if (manifest.name !== 'node-pty' || manifest.version !== '1.1.0') {
    throw new Error(`Unreviewed node-pty layout: ${manifest.name}@${manifest.version}`)
  }

  const prebuilds = join(source, 'prebuilds')
  const selectedDir = `${target.platform}-${target.arch}`
  const hostMatches = process.platform === target.platform && process.arch === target.arch
  const localBuild = ['Release', 'Debug'].some((kind) =>
    existsSync(join(source, 'build', kind)) && readdirSync(join(source, 'build', kind)).some((file) => file.endsWith('.node')))
  if (localBuild && !hostMatches) {
    throw new Error(`node-pty has a host-specific build that cannot be staged for ${target.triple}`)
  }

  const needed = target.platform === 'win32'
    ? ['conpty.node', 'pty.node', 'conpty_console_list.node', 'conpty/conpty.dll', 'conpty/OpenConsole.exe', 'winpty.dll', 'winpty-agent.exe']
    : ['pty.node', 'spawn-helper']
  const hasPrebuild = needed.every((file) => existsSync(join(prebuilds, selectedDir, file)))
  const hasLocalBuild = target.platform !== 'win32' && hostMatches
    && needed.every((file) => existsSync(join(source, 'build', 'Release', file)))
  if (!hasPrebuild && !hasLocalBuild) {
    throw new Error(`node-pty 1.1.0 is missing native assets for ${target.triple}`)
  }

  // Unknown sibling layouts require review before omission. This avoids silently
  // shipping a future native path which the loader could select ahead of prebuilds.
  const known = new Set(['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'])
  for (const entry of existsSync(prebuilds) ? readdirSync(prebuilds, { withFileTypes: true }) : []) {
    if (!entry.isDirectory() || !known.has(entry.name)) {
      throw new Error(`Unreviewed node-pty prebuild directory: ${entry.name}`)
    }
  }
  return (path) => {
    const parts = relative(prebuilds, path).split(sep)
    return parts[0] === '..' || parts[0] === '' || parts[0] === selectedDir
  }
}
