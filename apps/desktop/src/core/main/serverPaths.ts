import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const DESKTOP_PACKAGE_NAME = '@acorn/desktop'

function isDesktopPackage(dir: string): boolean {
  const manifest = join(dir, 'package.json')
  if (!existsSync(manifest)) return false
  try {
    return (JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown }).name === DESKTOP_PACKAGE_NAME
  } catch {
    return false
  }
}

// Source mode executes from src/core/main while electron-vite bundles this module into out/main.
// Find the package root by identity instead of encoding either module depth in runtime paths.
export function findDesktopRoot(startDir: string): string {
  let dir = resolve(startDir)
  for (;;) {
    if (isDesktopPackage(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Could not locate the ${DESKTOP_PACKAGE_NAME} package root from '${startDir}'.`)
    dir = parent
  }
}

export function resolveServerPaths(moduleDir: string): { clientDir: string; devDataDir: string } {
  const root = findDesktopRoot(moduleDir)
  return {
    clientDir: resolve(root, 'dist/client'),
    devDataDir: resolve(root, '.acorn'),
  }
}
