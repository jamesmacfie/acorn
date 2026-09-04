/** @jsxImportSource @opentui/solid */
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import { renderFixture } from './harness'
import { readFrame } from './golden'
import { SIZES, SURFACES } from './goldenSurfaces'

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
//
// **All 28 files have been corrected by hand and re-running this would undo it.** Phases 2, 3 and 4
// found 360 runs holding a colour no role in this app ever chose — OpenTUI's own
// `focusedBorderColor` on a focused box, its `placeholderColor` in a field — and corrected each to
// the colour the kit's role returned, against ui-design.md § Roles, and what each host makes of them.
// Re-running this puts every one of those hexes back. Two of the files were also re-captured in
// phase 4 with five real seconds of settle before the frame, because the originals were taken while
// a query was still in flight (./golden.test.ts § the goldens,
// docs/future/terminal-rewrite/phase-4-cut-over.md § What building it found).

// The delay ./browseSlow.test.tsx uses. Without it the fixture answers in a microtask, every cache
// is warm before the first frame, and the captured state is one no reader ever sees — the goldens
// want the screen after the queries resolved, not the screen a zero-latency transport produced.
process.env.ACORN_FIXTURE_DELAY_MS ??= '50'

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
