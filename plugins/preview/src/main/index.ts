// Electron-main adapter entrypoint. The implementation stays split by responsibility, while apps
// consume one reviewed surface rather than reaching through the plugin's internal files.
export {
  previewCurrentUrl,
  previewEvictTask,
  previewLoadUrl,
  previewNavigate,
  previewNavState,
  registerPreviewIpc,
} from './previewService'
