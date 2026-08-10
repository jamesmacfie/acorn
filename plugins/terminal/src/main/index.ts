// Main-process adapter entrypoint. Keep terminal engine implementation details behind one app-facing
// surface; node and desktop roots share this entrypoint for the small set of composition hooks.
export {
  configureTerminalMcp,
  reconcileTmux,
  refreshAcornMcpRegistrations,
} from './terminal'
// Safe to sit on this barrel only because it resolves `electron` at call time rather than at import
// (see the note in ./folderPickerIpc). apps/node's composition root imports `reconcileTmux` from
// here, and a barrel evaluates every module on it — a static electron import in any of these makes
// the standalone node unbootable.
export { registerFolderPickerIpc } from './folderPickerIpc'
