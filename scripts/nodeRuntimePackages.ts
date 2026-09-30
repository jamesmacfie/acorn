// Packages kept outside the service and helper bundles. Both desktop staging and standalone
// packaging need this set, including the headless terminal modules loaded through createRequire.
export const requiredRuntimePackages = [
  'node-pty',
  '@vscode/ripgrep',
  '@agentclientprotocol/claude-agent-acp',
  'playwright-core',
  '@xterm/headless',
  '@xterm/addon-serialize',
]
