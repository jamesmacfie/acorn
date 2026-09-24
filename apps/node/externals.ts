import { builtinModules } from 'node:module'

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
  // Native addons, or packages that find a binary beside their own files.
  'node-pty',
  '@vscode/ripgrep',
  'fsevents',
  // Optional native accelerators that ws and pg try to load and do without.
  'bufferutil',
  'utf-8-validate',
  'pg-native',
  // The Claude adapter runs as its own process from its installed path, and playwright-core is
  // imported on the first browser tool call and reads its own package files.
  '@agentclientprotocol/claude-agent-acp',
  'playwright-core',
]
// Also resolved at run time, but through `createRequire`, which the bundler does not follow:
// @xterm/headless and @xterm/addon-serialize.

const builtins = new Set(builtinModules)

// A bare `import 'path'` with no node: prefix is a builtin too. Some builtins, node:sqlite among them,
// exist only with the prefix and are listed that way.
export const isRuntimeResolved = (id: string): boolean =>
  builtins.has(id) || builtins.has(id.replace(/^node:/, '')) || RUNTIME_RESOLVED.some((name) => id === name || id.startsWith(`${name}/`))
