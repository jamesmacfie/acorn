// Stable client entrypoint. The implementation remains TSX because it renders UI, but app roots
// should depend on the plugin's entrypoint rather than its file extension.
export { onboardingClientPlugin } from './index.tsx'
