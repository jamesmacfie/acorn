// Packages kept outside the service and helper bundles. Both desktop staging and standalone
// packaging need this set, including the headless terminal modules loaded through createRequire.
export const requiredRuntimePackages = [
  'node-pty',
  'sharp', // Bounded workspace thumbnail decoding on the Node.
  'node-forge', // Loaded synchronously only for first-run certificate generation.
  '@vscode/ripgrep',
  '@agentclientprotocol/claude-agent-acp',
  'playwright-core',
  '@xterm/headless',
  '@xterm/addon-serialize',
  // run_script's interpreter. Its loader finds the .wasm file beside its own code, which bundling breaks.
  'quickjs-emscripten-core',
  '@jitl/quickjs-wasmfile-release-sync',
]
