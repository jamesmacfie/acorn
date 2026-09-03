import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import { renderFixture } from './harness'
import { compare, readFrame, type Frame } from './golden'
import { SIZES, SURFACES } from './goldenSurfaces'
import { drawsOwn } from './painter'

// The painter swap, judged against the frames the painter we are leaving drew.
//
// Skipped unless the build asked for our painter, so the default suite is unaffected until phase 4
// takes the switch out:
//
//   ACORN_TUI_PAINTER=own pnpm --filter @acorn/tui test src/golden.test.ts
//
// The promise a golden holds is every cell and every run, which is stricter than anything else in
// this package tests and deliberately so: the kit is tested by intent — `Badge` draws `[text]` — and
// that is the right test for a kit people keep changing and the wrong one for a swap whose whole
// claim is that nothing moved (./golden.ts).
//
// **Not one golden in the set is widget-free, and the phase file assumed most of them would be.**
// § Goal asks this file to compare "every golden frame from phase 0 that contains no scroll
// viewport, input, textarea, or pty rectangle", and the answer is none of the 28: every panel that
// scrolls is a `scrollbox`, and every overlay is drawn over a shell whose browse pane carries a
// filter field. So the rule that was meant to pick surfaces picks nothing, and the useful question
// turned out to be finer: which surfaces our painter draws cell for cell anyway, and which hold a
// widget that draws content of its own and therefore waits for phase 3. The list below is that
// answer, measured rather than assumed
// (docs/future/terminal-rewrite/phase-2-the-painter.md § What building it found).
//
// **188 runs across those 16 goldens were corrected rather than matched.** Every one of them was
// `#00AAFF`, the default `focusedBorderColor` of OpenTUI's `BoxRenderable`: the caret mirror focuses
// whatever the store focused, and a focused box then drew its own colour over the `borderColor` the
// role handed it. On a terminal a tone is "default, and the palette's grey, accent, green, yellow and
// red" (docs/ui-design.md § Roles, and what each host makes of them), and that hex is none of the sixteen,
// so the sentence won and each run took the colour `../kit/roles.ts § boxBorder` returned — the accent
// slot on a lit panel, the terminal's own foreground on an overlay that names no tone.

/** The delay the goldens were captured with. Without it every cache is warm before the first frame
 *  and the screen is one no reader ever sees (./captureGolden.tsx). */
process.env.ACORN_FIXTURE_DELAY_MS ??= '50'

/**
 * Surfaces this phase does not draw, and the widget in each that phase 3 owes it.
 *
 * A `scrollbox` whose content fits is a box, and our paint draws one — that is why this list is six
 * surfaces rather than all fourteen. What is on it is a rectangle with content or an API of its own:
 * a field's value or placeholder, a `Textarea`'s `setText`, a viewport's `viewport`. Those are phase
 * 3's, and until then the comparison would be reporting the absence of work nobody has done.
 *
 * Two of the six are one row from matching. `notes` at 80 differs by the seven characters of a
 * placeholder, and `browse` by the one row an `Input` is a cell tall to OpenTUI and nothing to us.
 * The other four throw inside a component reaching for a widget's own API, which the panel catches
 * and draws — `! notes area.setText is not a function` in the pane's own frame, which is `PanelBody`
 * doing exactly what it promises (../panel.tsx).
 */
const PHASE_3: Readonly<Record<string, string>> = {
  browse: 'the filter Input, whose row is a cell tall to OpenTUI and nothing to us',
  changes: 'the filter Input at 80, and a scrollbox\'s own `viewport` at 120 (../kit/showing.tsx)',
  notes: 'the filter Input\'s placeholder at 80, and the Textarea\'s `setText` at 120',
  agents: 'the transcript Textarea\'s `setText` (../kit/asking.tsx)',
  pr: 'a scrollbox\'s own `viewport`, which the fit measure reads a height off',
  palette: 'the search Input\'s placeholder line',
}

const OUT = resolve(import.meta.dirname, '../golden')

const readGolden = async (name: string): Promise<Frame> =>
  JSON.parse(await readFile(resolve(OUT, `${name}.json`), 'utf8')) as Frame

/** The first few differences and how many there were. Every one is in the report, and a painter that
 *  has shifted a column has shifted every line below it, so a failure message that printed all of
 *  them would bury the one that matters (./golden.ts § compare). */
const say = (found: readonly string[]): string =>
  `${found.length} difference${found.length === 1 ? '' : 's'}\n\n${found.slice(0, 4).join('\n\n')}`

describe.skipIf(!drawsOwn())('the goldens, under our own painter', () => {
  for (const size of SIZES) {
    for (const surface of SURFACES) {
      const name = `${surface.name}-${size.width}x${size.height}`
      const owed = PHASE_3[surface.name]
      it.skipIf(owed !== undefined)(`draws ${name} cell for cell${owed ? ` (phase 3: ${owed})` : ''}`, async () => {
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
          // The two things the capture cleared right before taking its frame, for the same reasons:
          // a debug overlay is not part of any surface, and a toast left by an earlier render is not
          // either (./captureGolden.tsx).
          screen.renderer.console.deactivate()
          screen.renderer.console.hide()
          for (const stale of activeToasts()) dismissToast(stale.id)
          const live = await readFrame(screen, surface.name, size.width, size.height)
          const found = compare(live, await readGolden(name))
          expect(found, say(found)).toEqual([])
        } finally {
          screen.done()
        }
      }, 200_000)
    }
  }
})
