// The three built-in agent profiles, and the honest statement of what a profile is.
//
// Each of these used to be its own workspace package — plugins/profiles-{claude,codex,aider}, 95 lines
// of implementation across three package.json files, three vitest configs and nine files of
// boilerplate. The shape advertised an extensibility that did not exist: everything that actually
// encodes Claude/Codex knowledge — the drivers, the normalizers, the usage probes, the pricing tables
// — lives in this plugin, and node/index.ts registers 'claude' and 'codex' drivers by literal. Adding
// a profiles package bought you a menu entry whose agent could not run.
//
// Folded in, and the seam is now described accurately: an agent PROFILE is first-party. A third-party
// agent CLI needs a driver, and the driver registry is not a contribution point today. That is a real
// gap, and it is better stated than papered over with three empty packages.
//
// There is no aider DRIVER, only an aider profile — which is what the old shape hid: aider ran
// headless, never managed.
export { aiderProfile } from './aider'
export { claudeCodeProfile } from './claudeCode'
export { codexProfile } from './codex'
