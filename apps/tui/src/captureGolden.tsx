/** @jsxImportSource @opentui/solid */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import type { PluginTrustRequest } from '@acorn/client-core/host/plugins/distribution.ts'
import { renderFixture, type Screen } from './harness'
import { readFrame } from './golden'

// The golden set: every surface the reachability suite walks, plus every overlay, at both sizes,
// written to `apps/tui/golden/` (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md).
//
//   pnpm --filter @acorn/tui golden
//
// It drives the harness rather than the renderer, so it settles the way ./panes.test.tsx does and a
// golden is a frame the suite would have asserted on. A sibling of ./capture.tsx rather than a mode
// of it: that one prints a frame for a person to look at and this one writes data for phases 2 and 3
// to compare against, and the two have nothing in common but the harness they share.
//
// Nothing here is a test. The files are data until phase 2 compares against them, and phase 4
// deletes them along with ./golden.ts once the intent tests run against the new painter.

// The delay ./browseSlow.test.tsx uses. Without it the fixture answers in a microtask, every cache
// is warm before the first frame, and the captured state is one no reader ever sees — the goldens
// want the screen after the queries resolved, not the screen a zero-latency transport produced.
process.env.ACORN_FIXTURE_DELAY_MS ??= '50'

/** The one bundle this device has never decided about, which is what raises the trust prompt. Copied
 *  from ./keys/keys.test.tsx, because the prompt draws the row's own name and version. */
const TRUST: PluginTrustRequest = {
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

type Surface = {
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
const SURFACES: Surface[] = [
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

const SIZES = [{ width: 80, height: 24 }, { width: 120, height: 40 }]

const OUT = resolve(import.meta.dirname, '../golden')

await mkdir(OUT, { recursive: true })

for (const size of SIZES) {
  for (const surface of SURFACES) {
    _resetNotices()
    for (const notice of surface.notices ?? []) pushNotice(notice)
    const screen = await renderFixture({
      ...size,
      ...(surface.pane ? { pane: surface.pane } : {}),
      ...(surface.supervised ? { supervised: true } : {}),
      ...(surface.trust ? { trust: surface.trust } : {}),
    })
    try {
      await screen.until(surface.until, 45)
      await surface.open?.(screen)
      // OpenTUI's own debug console, sent away again. The harness deactivates and hides it once
      // during the boot settle, and anything that logs afterwards pops it back over the frame — the
      // fixture answers the notes pane's debounced title save with a 404, and that alone put
      // `Console (Focused)` and a copy button into `help-120x40`. A golden records the app, so the
      // overlay has to go right before the frame is taken rather than once at the start.
      screen.renderer.console.deactivate()
      screen.renderer.console.hide()
      // …and any toast left over from an earlier surface. `onCleanup` in the notes model flushes its
      // debounced save when the pane unmounts, so tearing that render down fires a request whose
      // "Note saved" lands in whichever render is up when it answers — which is how a toast from the
      // notes capture turned up above the footer of `palette-120x40` on one run and not the next.
      // A toast is not part of any surface here, so the frame is taken without one.
      for (const stale of activeToasts()) dismissToast(stale.id)
      const frame = await readFrame(screen, surface.name, size.width, size.height)
      const file = resolve(OUT, `${surface.name}-${size.width}x${size.height}.json`)
      await writeFile(file, `${JSON.stringify(frame, null, 2)}\n`)
      process.stdout.write(`${file}\n`)
    } finally {
      screen.done()
    }
  }
}

// Explicit, because the renderer keeps timers and a listener on stdin: without it the process draws
// its last frame and then sits there, which is what ./capture.tsx says by doing the same.
process.exit(0)
