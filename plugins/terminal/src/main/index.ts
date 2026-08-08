// Main-process adapter entrypoint. Keep terminal engine implementation details behind one app-facing
// surface; node and desktop roots share this entrypoint for the small set of composition hooks.
export {
  configureTerminalMcp,
  reconcileTmux,
  refreshAcornMcpRegistrations,
} from './terminal'
export { registerFolderPickerIpc } from './folderPickerIpc'
