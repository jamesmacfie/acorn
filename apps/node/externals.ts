import { builtinModules } from 'node:module'
import { requiredRuntimePackages } from '../../scripts/nodeRuntimePackages'

// What the node's builds leave for Node to resolve from node_modules at run time. Everything else
// is bundled, third-party packages included. Loading a package as its own files costs the module
// loader one resolve and link per file, and drizzle alone is about a hundred files. Bundling took the
// service chunk's evaluation from about 315 ms to about 115 ms, and the helper's time to its ready
// line from about 305 ms to about 80 ms, on an M2 Pro.
//
// Shared by the service build (./vite.config.ts) and the desktop helper's
// (apps/desktop/vite.helper.config.ts), so the two cannot disagree about what has to be installed
// beside them.
const RUNTIME_RESOLVED = [
  ...requiredRuntimePackages,
  // Optional native accelerators and platform packages that can be absent.
  'fsevents', 'bufferutil', 'utf-8-validate', 'pg-native',
]

const builtins = new Set(builtinModules)

// A bare `import 'path'` with no node: prefix is a builtin too. Some builtins, node:sqlite among them,
// exist only with the prefix and are listed that way.
export const isRuntimeResolved = (id: string): boolean =>
  builtins.has(id) || builtins.has(id.replace(/^node:/, '')) || RUNTIME_RESOLVED.some((name) => id === name || id.startsWith(`${name}/`))
