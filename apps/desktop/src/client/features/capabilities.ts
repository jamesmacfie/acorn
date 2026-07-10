// What the hosting environment provides (docs/features.md, docs/electron.md §capability-map). After
// Phase 3 the preload is a thin residue (native folder picker + browser:bind + the ⌘W ping); the
// data surface is loopback HTTP + one WebSocket, so most panes work in a plain browser (`dev:node`)
// too. `desktop` still marks the Electron build; `terminal` marks that the main-process engine is
// present — the surfaces that genuinely need it (terminal drawer, agents, run targets, workflows,
// the PTY streams) key off it and degrade with a visible reason where it's absent. Consumers that
// *invoke* the bridge use the typed accessors (terminalApi() etc.); this answers "is it available?".
export type Capabilities = {
  desktop: boolean // preload bridge present (Electron renderer)
  terminal: boolean // main-process terminal/worktree engine available (drawer, agents, run targets, workflows, PTY streams)
}

export type ClientCapabilityRequirement = 'none' | keyof Capabilities

export const capabilities = (): Capabilities => ({
  desktop: !!window.acorn?.desktop,
  terminal: !!window.acorn?.terminal,
})

export const hasClientCapability = (requirement: ClientCapabilityRequirement = 'none'): boolean =>
  requirement === 'none' || capabilities()[requirement]
