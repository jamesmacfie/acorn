// What the hosting environment provides (docs/features.md, docs/electron.md §capability-map). The
// preload is a thin residue (native folder picker, preview view controls, lifecycle callbacks); the
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

// The residual preload bridge. Everything request/response is loopback HTTP and every stream is the
// WebSocket (wsClient.ts); what survives here are the things that genuinely cannot be either — the
// native folder picker (dialog.showOpenDialog) and the main-owned preview WebContentsView.
//
// `terminal` is also the desktop-mode probe: the typed accessors built on it (taskBridge(),
// terminalApi()) return null when it is absent, which is what every `if (!api)` guard keys off. The
// global is declared HERE, in core, because core's own capability map reads it — declaring it in a
// feature would mean core's contract was typed by a plugin. One declaration site only.
export type TerminalStreamBridge = {
  repoPath: { pick(): Promise<string | null> }
}

// Chrome state pushed from main for the active preview view (PreviewPane consumes it).
export type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

declare global {
  interface Window {
    acorn?: {
      desktop?: boolean
      platform?: string
      // Cmd/Ctrl+W → close the focused pane. Returns an unsubscribe.
      onClosePane?: (cb: () => void) => () => void
      // App quit lifecycle concern collection. Returns an unsubscribe.
      onWillQuit?: (cb: () => boolean | Promise<boolean>) => () => void
      terminal?: TerminalStreamBridge
      // Browser-preview surface: drive the task's main-owned WebContentsView.
      preview?: {
        ensure(taskId: string, url: string): Promise<boolean>
        setBounds(taskId: string, rect: { x: number; y: number; width: number; height: number }): void
        show(taskId: string): void
        hide(): void
        load(taskId: string, url: string): void
        command(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools'): void
        evict(taskId: string): void
        onEvent(cb: (s: PreviewState) => void): () => void
      }
    }
  }
}

export const capabilities = (): Capabilities => ({
  desktop: !!window.acorn?.desktop,
  terminal: !!window.acorn?.terminal,
})

export const hasClientCapability = (requirement: ClientCapabilityRequirement = 'none'): boolean =>
  requirement === 'none' || capabilities()[requirement]

// Typed accessor for the injected preload global.
//
// `declare global { interface Window }` above only applies to programs that include THIS file. A
// consumer compiling a module that merely says `window.acorn` — taskBridge.ts did — sees a bare
// Window and fails once it is compiled from another package. Reaching for the global through this
// function makes the augmentation travel with the import graph.
export const acornGlobal = (): Window['acorn'] => window.acorn
