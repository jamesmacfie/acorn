// What the hosting environment provides (docs/features.md). The desktop (Electron) build injects
// the `window.acorn` preload bridge; a plain browser session (`pnpm --filter @acorn/desktop
// dev:node`) has none, so every terminal-backed surface degrades to its bridge-absent fallback.
// This is THE capability check — the old `acorn:term` localStorage flag is gone: the terminal
// underpins shipped features and is always on when the bridge exists. Consumers that *invoke* the
// bridge still use the typed accessors (terminalApi() etc.); this answers "is it available?".
export type Capabilities = {
  desktop: boolean // preload bridge present (Electron renderer)
  terminal: boolean // terminal/worktree service available (drawer, agents, run targets, workflows)
}

export const capabilities = (): Capabilities => ({
  desktop: !!window.acorn?.desktop,
  terminal: !!window.acorn?.terminal,
})
