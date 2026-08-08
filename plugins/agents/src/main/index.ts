// Main-process entrypoint for the built-in profile contributions. Drivers and runtime internals
// remain feature-owned; the composition root only needs the registered profile values.
export { aiderProfile, claudeCodeProfile, codexProfile } from './profiles/index'
