// Which painter this build draws with.
//
// `ACORN_TUI_PAINTER=own` points the `@opentui/solid` alias at `./tree/renderer.ts` and this constant
// at `own`; anything else leaves both where they were. Read from a define rather than from
// `process.env` at runtime so the branch is decided at build time and the painter nobody chose is not
// in the graph — which is also why there is no third value and no registry: the switch is an alias
// and a define (../vite.config.ts, docs/future/terminal-rewrite/phase-2-the-painter.md).
//
// Temporary by construction. Phase 4 removes OpenTUI, and with it this file and every `drawsOwn()`
// beside it.

declare const __ACORN_PAINTER__: 'opentui' | 'own'

/** `opentui` unless the build said otherwise, including under a tool that defines nothing. */
export const PAINTER: 'opentui' | 'own' = typeof __ACORN_PAINTER__ === 'undefined' ? 'opentui' : __ACORN_PAINTER__

export const drawsOwn = (): boolean => PAINTER === 'own'
