import type { PluginTrustRequest } from '@acorn/client-core/host/plugins/distribution.ts'
import type { pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import type { Screen } from './harness'

// The golden set's own list: which surfaces are captured, at which sizes, and what puts each one on
// screen (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md).
//
// Its own module because two callers need the same list and a second copy would drift: `./captureGolden.tsx`
// writes the files and `./golden.test.ts` compares against them, and a surface added to one and not
// the other is either a golden nothing checks or a check with no golden. Phase 4 deletes both callers
// and this with them.

/** The one bundle this device has never decided about, which is what raises the trust prompt. Copied
 *  from ./keys/keys.test.tsx, because the prompt draws the row's own name and version. */
export const TRUST: PluginTrustRequest = {
  nodeId: 'node-1',
  hash: 'a'.repeat(64),
  row: {
    name: 'board',
    required: false,
    disabled: false,
    running: false,
    state: 'active',
    installed: {
      version: '1.0.0',
      apiVersion: '9',
      permissions: { api: [], events: [], node: { core: [], capabilities: [], secrets: false, exec: false, net: [] } },
      contributions: { frames: [] },
      client: null,
    },
  },
}

export type Surface = {
  name: string
  pane?: string
  /** Held before the frame is taken, and again after `open` where the overlay says something new. */
  until: string
  supervised?: boolean
  trust?: readonly PluginTrustRequest[]
  /** Notices to seed, for the one surface that draws them. Every other surface is captured with none:
   *  the ring is module state the harness does not reset, so a surface that left notices behind would
   *  put a count in the next surface's topbar and make its golden depend on the order this list
   *  happens to be in (../chrome/Inbox.tsx, client-core features/notifications/notifications.ts). */
  notices?: readonly Parameters<typeof pushNotice>[0][]
  /** Put the screen in the state being captured, after its first draw. */
  open?: (screen: Screen) => Promise<void>
}

/**
 * The fourteen surfaces.
 *
 * The first eight are the reachability suite's own list, in its order, and they are the list because
 * the sweep is the programme's acceptance property: a surface the property walks is a surface the new
 * painter has to draw the same. The six after them are the overlays, which the sweep does not walk —
 * it opens only the cheat sheet — and which are the whole of the chrome a reader reaches by key
 * (./reachability.test.tsx, ./chrome/state.ts § OverlayName).
 *
 * A pane that joins the roster joins the sweep, and it should join this list on the same day.
 */
export const SURFACES: Surface[] = [
  { name: 'browse', until: 'Invalidate' },
  { name: 'agents', pane: 'agents', until: 'MANAGED SESSIONS' },
  { name: 'pr', pane: 'pr', until: '#42' },
  { name: 'changes', pane: 'changes', until: 'STAGED' },
  { name: 'notes', pane: 'notes', until: 'Repro steps' },
  { name: 'context', pane: 'context', until: 'Working tree' },
  { name: 'editor', pane: 'editor', until: '$EDITOR' },
  {
    name: 'help',
    until: 'Invalidate',
    open: async (screen) => { await screen.press('?'); await screen.until('Keys') },
  },
  {
    name: 'palette',
    until: 'Invalidate',
    open: async (screen) => { await screen.press('k', { ctrl: true }); await screen.until('Commands') },
  },
  {
    name: 'inbox',
    until: 'Invalidate',
    // Two notices, because the inbox with nothing in it is an empty state and the thing worth pinning
    // is a row. Fixed timestamps rather than `Date.now()`: the goldens are compared byte for byte and
    // a clock in the data would be the one thing that never matches.
    notices: [
      { taskId: 'task-1', kind: 'agent-needs-input', title: 'claude needs you', at: 0 },
      { taskId: 'task-1', kind: 'agent-completed', title: 'claude finished', at: 0 },
    ],
    open: async (screen) => { await screen.press('n'); await screen.until('Notifications') },
  },
  {
    name: 'workspace',
    until: 'Invalidate',
    open: async (screen) => { await screen.press('w'); await screen.until('Workspace') },
  },
  {
    name: 'project',
    until: 'Invalidate',
    open: async (screen) => { await screen.press('p'); await screen.until('Project') },
  },
  {
    name: 'quit',
    until: 'Invalidate',
    // Only a run that started its own node is asked (../chrome/Shell.tsx § QuitConfirm). One that
    // merely attached quits on the key, and there is no overlay to capture.
    supervised: true,
    open: async (screen) => { await screen.press('q'); await screen.until('Quit and stop the node') },
  },
  {
    name: 'trust',
    // The one overlay nobody opens by hand: the shell raises it while a bundle is waiting on a
    // decision, so seeding the queue is the whole of opening it.
    //
    // Two waits, in this order, because the prompt is up before the shell behind it has filled and
    // waiting on the prompt alone caught the topbar mid-flight: one run captured `acorn · 0 tasks`
    // and the next `acorn > acorn · 1 task`. The task count first, then the prompt.
    until: '1 task',
    open: async (screen) => { await screen.until('Run board?') },
    trust: [TRUST],
  },
]

export const SIZES = [{ width: 80, height: 24 }, { width: 120, height: 40 }]
