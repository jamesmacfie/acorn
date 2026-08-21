// Main-process adapter entrypoint. Keep terminal engine implementation details behind one app-facing
// surface; node and desktop roots share this entrypoint for the small set of composition hooks.
export {
  configureTerminalMcp,
  reconcileTmux,
  refreshAcornMcpRegistrations,
} from './terminal'
// Safe on this barrel only because folderPickerIpc resolves electron at call time, not at import
// (docs/plugins.md § Package shape). apps/node's composition root imports reconcileTmux from here,
// and a barrel evaluates every module on it.
export { registerFolderPickerIpc } from './folderPickerIpc'
