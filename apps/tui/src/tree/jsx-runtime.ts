// Where tsc looks for this host's JSX namespace, and nothing else.
//
// Every `.tsx` in this package opens with `@jsxImportSource @acorn/tui/jsx`, which `tsconfig.json`
// maps to this file. It exists because that pragma is spelled as a package rather than as a path: TS
// resolves `<source>/jsx-runtime` and reads the `JSX` namespace out of it, so the namespace has to
// live in a module with that name at the end.
//
// There is no runtime half and there must not be one. The build reads `moduleName` in
// `../../vite.config.ts` and emits calls to `./renderer.ts` whatever the pragma says, so a `jsx` or
// `jsxs` function exported here would be a second answer nothing calls
// (docs/future/terminal-rewrite/phase-4-cut-over.md).

export type { JSX } from './jsx'
