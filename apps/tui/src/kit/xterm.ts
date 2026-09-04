// The browser xterm.js and its two addons, as this host's answer: a throw.
//
// The seventh alias in the host switch (../vite.config.ts). Four specifiers resolve here —
// `@xterm/xterm`, its stylesheet, `@xterm/addon-fit` and `@xterm/addon-webgl`.
//
// **`@xterm/headless` is not one of them and must never be.** That is the emulator behind this host's
// own `pty` rectangle: it parses the bytes a shell writes into a grid we then paint as cells
// (./rectangle.tsx). The three aliased here are the other half of that library — a `<canvas>`, a
// WebGL context and a DOM measurement pass — and there is none of that in a terminal.
//
// **What reaches them.** `plugins/terminal/src/client/TerminalSurface.tsx`, through `TerminalPanel`,
// which the terminal plugin registers as a `UiSlotContribution` for the desktop's drawer. This host
// has no UI-slot host at all, so nothing can mount it; the chunk exists because the plugin's client
// barrel is in the roster, not because anything here renders it.
//
// **Why an alias rather than a dependency.** The bundle externalises every bare import, so without
// this the three packages have to stay installed for a surface that cannot mount. Everything here
// throws rather than answering plausibly, so a surface that does reach one says which host it is on
// (docs/future/terminal-rewrite/phase-4-cut-over.md).

const absent = (what: string): never => {
  throw new Error(
    `${what} is browser xterm.js, and the terminal client has no canvas to draw it on. `
    + 'This host runs a shell in the `pty` rectangle over @xterm/headless instead '
    + '(apps/tui/src/kit/xterm.ts, apps/tui/vite.config.ts).',
  )
}

export class Terminal {
  constructor() { absent('Terminal') }
}

export class FitAddon {
  constructor() { absent('FitAddon') }
}

export class WebglAddon {
  constructor() { absent('WebglAddon') }
}

/** `@xterm/xterm/css/xterm.css`, imported for its side effects. A stylesheet has nothing to throw
 *  about: there is no document to put it in and no surface is worse off for that. */
export default undefined
