import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import { renderFixture } from './harness'
import { compare, readFrame, type Frame } from './golden'
import { ATTRS } from './paint/buffer'
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
// **Five of the twenty-eight are still held, and none of the five is held by a widget.** The two
// field slices took `browse`, `palette`, `notes` at 80 and `pr` off this list, and what is left is
// two measured differences that sit under the painter rather than in it. `changes` and `agents` at 80
// differ by rows of content, and it is the harness rather than the painter: our `flush` turns the loop
// until the tree stops asking for frames, which drains the fixture's delayed answers, so a section
// the capture never saw is on screen. On `agents` that is measured rather than argued — the old
// painter driven through this same harness draws exactly the cells ours does, on every row. `changes`,
// `agents` and `notes` at 120 differ by one cell on rows that overflow their column, where the last
// child keeps a cell under OpenTUI that it loses here: the two Yoga builds round negative free space
// differently (docs/future/terminal-rewrite/phase-3-widgets-and-the-pty.md § What building it found).
//
// **325 runs across the set were corrected rather than matched, and they carry two colours between
// them.** 320 were `#00AAFF`, the default `focusedBorderColor` of OpenTUI's `BoxRenderable`: the caret
// mirror focuses whatever the store focused, and a focused box then drew its own colour over the
// `borderColor` the role handed it. Five were `#666666`, `TextareaRenderable`'s default
// `placeholderColor`. On a terminal a tone is "default, and the palette's grey, accent, green, yellow
// and red" (docs/ui-design.md § Roles, and what each host makes of them), and neither hex is one of the
// sixteen, so the sentence won: each run took the colour the kit's own role returned, read off the live
// frame at the same column and refused unless it was one of the slots — the accent slot on a lit panel,
// the terminal's own foreground on an overlay that names no tone, the palette's grey on a placeholder.

/** The delay the goldens were captured with. Without it every cache is warm before the first frame
 *  and the screen is one no reader ever sees (./captureGolden.tsx). */
process.env.ACORN_FIXTURE_DELAY_MS ??= '50'

/**
 * Goldens still held, by name and size, with what each is waiting for and how far off it is.
 *
 * By the full name rather than by surface, because the reasons stopped agreeing across the two sizes:
 * at 80 the harness settles deeper than the capture did, and at 120 the two Yoga builds round a
 * squeezed row differently. Neither is a widget and neither is above the layout pass, so nothing here
 * is a to-do list — each of these is a difference to accept, a Yoga question for somebody with a
 * spare afternoon, or a re-capture (§ Five of the twenty-eight are still held).
 *
 * The counts were measured with this table emptied, on 2026-09-04, and every other golden in the set
 * matched in the same run. They are counts of *differences* rather than of rows: one row that has
 * shifted a cell is several, because the characters and the runs are compared separately.
 */
const PHASE_3: Readonly<Record<string, string>> = {
  'changes-80x24': '23 differences, and the pane\'s own header row is what they are: this harness '
    + 'settles far enough to draw it and the capture did not',
  'changes-120x40': '15 differences: one cell of squeeze per overflowing row, plus the blue border '
    + 'runs phase 2 could not correct because the rows they sit on do not line up',
  'agents-80x24': '12 differences, over six rows of a section this harness settles far enough to '
    + 'show; the old painter driven through the same harness draws the same cells on every row, so '
    + 'the painters agree and the capture is the shallower screen',
  'agents-120x40': '10 differences: one cell of squeeze on the header row, and the composer\'s hint '
    + 'wrapping a row differently because of it',
  'notes-120x40': '4 differences: one cell of squeeze on two overflowing rows',
}

/**
 * The one span in the set that is not deterministic, neutralised on both sides rather than compared.
 *
 * `notes-80x24` is the file phase 0's determinism check could not reproduce: it flips a single
 * `inverse` bit on the word `Scratchpad` across runs, and five runs came out inverse, plain, plain,
 * plain, inverse, so both states are where the screen comes to rest. What varies is whether the notes
 * list ends up marking the note it is showing, which is a fault a reader meets rather than an
 * artefact of the capture, and phase 0 asked for it to be held as an accepted difference until
 * somebody chases the race (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § The golden
 * set).
 *
 * One bit on one run rather than the whole row, so everything else about that span is still compared:
 * a golden that cannot be trusted about one bit should not become a golden nobody checks.
 */
const RACES: Readonly<Record<string, string>> = {
  'notes-80x24': 'Scratchpad',
}

const settled = (frame: Frame, name: string): Frame => {
  const mark = RACES[name]
  if (mark === undefined) return frame
  return {
    ...frame,
    runs: frame.runs.map((line) => line.map((span) => (
      span.text.includes(mark) ? { ...span, attributes: span.attributes & ~ATTRS.inverse } : span
    ))),
  }
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
      const owed = PHASE_3[name]
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
          const found = compare(settled(live, name), settled(await readGolden(name), name))
          expect(found, say(found)).toEqual([])
        } finally {
          screen.done()
        }
      }, 200_000)
    }
  }
})
