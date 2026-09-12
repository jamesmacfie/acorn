// What a caller filling a `pty` rectangle says, and what it never says.
//
// A `Rectangle` promises that the host draws the box and what is inside it. For `pty` the DOM kept
// half of that promise: it handed over an element and three plugins each built their own xterm on it,
// with their own theme, their own fit and their own resize observer. A terminal host has no element to
// hand over, so the promise had to be kept properly — and the shape below is what was left once the
// emulator moved to the host: a channel to open, bytes in, bytes out, and a size.
//
// Types only, and no imports, so a node-environment test and a tree bundle can both name them
// (docs/ui-design.md § The closed kit, docs/terminal.md § Client).

/** What the far end of a PTY says. The same two messages every channel in the app already sends. */
export type PtyEvent =
  | { kind: 'out'; data: string }
  | { kind: 'exit'; code: number | null }

/** A PTY, as the plugin that owns it describes it to the host. */
export type PtyIo = {
  /**
   * Open the channel at this size and start delivering. Returns the dispose, which the host calls
   * when the rectangle goes away.
   *
   * The size comes first because a PTY that learns its width late redraws a full-screen program at
   * the wrong one, and vim is one.
   */
  open: (size: { cols: number; rows: number }, onEvent: (event: PtyEvent) => void) => () => void
  /** What the reader typed. */
  input: (data: string) => void
  /** The box changed size. */
  resize: (size: { cols: number; rows: number }) => void
  /** Drawn into the terminal when the far end exits, if the caller wants a word about it. */
  farewell?: string
}
