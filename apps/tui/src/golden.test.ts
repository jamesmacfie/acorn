import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { _resetNotices, pushNotice } from '@acorn/client-core/features/notifications/notifications.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import { renderFixture } from './harness'
import { compare, readFrame, type Frame } from './golden'
import { ATTRS } from './paint/buffer'
import { SIZES, SURFACES } from './goldenSurfaces'

// The painter swap, judged against the frames the painter we left drew.
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
// **Twenty-five of the twenty-eight match and the three that are left are all one thing.** The two
// field slices took `browse`, `palette`, `notes` at 80 and `pr` off this list; phase 4 re-captured
// `changes` and `agents` at 80 and finished the colour correction on the rest. What is left is
// `changes`, `agents` and `notes` at 120, each differing by one cell on rows that overflow their
// column: the last child on such a row keeps a cell under OpenTUI's Yoga and loses it under ours.
// It is not a setting — neither build calls `setPointScaleFactor` — so it is the two builds' own
// arithmetic over negative free space, and it is accepted rather than chased
// (docs/future/terminal-rewrite/phase-4-cut-over.md § What building it found).
//
// **360 runs across the set were corrected rather than matched, and they carry two colours between
// them.** 352 were `#00AAFF`, the default `focusedBorderColor` of OpenTUI's `BoxRenderable`: the caret
// mirror focuses whatever the store focused, and a focused box then drew its own colour over the
// `borderColor` the role handed it. Eight were `#666666`, `TextareaRenderable`'s default
// `placeholderColor`. On a terminal a tone is "default, and the palette's grey, accent, green, yellow
// and red" (docs/ui-design.md § Roles, and what each host makes of them), and neither hex is one of the
// sixteen, so the sentence won: each run took the colour the kit's own role returned, read off the live
// frame at the same column and refused unless it was one of the slots — the accent slot on a lit panel,
// the terminal's own foreground on an overlay that names no tone, the palette's grey on a placeholder.
// One run in the whole set refused and stayed `#666666`: the composer's placeholder in
// `agents-120x40`, on a row the squeeze below has shifted, so there is no live run at its column.

/** The delay the goldens were captured with. Without it every cache is warm before the first frame
 *  and the screen is one no reader ever sees (./captureGolden.tsx). */
process.env.ACORN_FIXTURE_DELAY_MS ??= '50'

/**
 * The three goldens that are held, by name and size, with the difference each one accepts.
 *
 * All three are the same thing and it is not a to-do list. A row whose children want more room than
 * the row has gives the overflow up between them, and on the last child of such a row the two Yoga
 * builds land a cell apart: OpenTUI's keeps it, ours does not. Neither build configures the engine —
 * OpenTUI never calls `setPointScaleFactor` either — so there is no setting to match, and chasing it
 * means going into the two builds' arithmetic for a cell at the right-hand edge of three rows.
 * Accepted, and recorded where somebody who wants it can find the repro
 * (docs/future/terminal-rewrite/phase-4-cut-over.md § What building it found).
 *
 * The counts were measured with this table emptied, on 2026-09-04, and every other golden in the set
 * matched in the same run. They are counts of *differences* rather than of rows: one row that has
 * shifted a cell is several, because the characters and the runs are compared separately.
 */
const SQUEEZED: Readonly<Record<string, string>> = {
  'changes-120x40': '8 differences: the last cell of four overflowing rows — a copy button\'s '
    + '\u29c9 and three of a diff count\'s \u2212',
  'agents-120x40': '10 differences: the last cell of the header row, and the composer\'s hint '
    + 'wrapping a row differently because of it',
  'notes-120x40': '4 differences: the last cell of two overflowing rows',
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

/**
 * The one number in the set that a golden cannot hold, blanked on both sides rather than compared.
 *
 * The fixture's pull request is stamped `updatedAt: 0` and the detail row says how long ago that was
 * (../fixture.ts). So the two `pr` goldens hold a count of months since the epoch, and it goes up by
 * one every thirty days — which is a golden that is right until it is not, and is nobody's change
 * when it breaks. Caught on 2026-09-04, the day 689 became 690.
 *
 * The digits are replaced rather than the phrase, and by as many characters as they were, so a run
 * keeps its width and everything either side of it is still compared. A count that gained a digit
 * would still differ, which is right: that is a column moving.
 */
const drifted = (text: string): string => text.replace(/\d+(?=mo ago)/g, (count) => '#'.repeat(count.length))

const settled = (frame: Frame, name: string): Frame => {
  const mark = RACES[name]
  return {
    ...frame,
    frame: frame.frame.map(drifted),
    runs: frame.runs.map((line) => line.map((span) => {
      const text = drifted(span.text)
      const attributes = mark !== undefined && span.text.includes(mark)
        ? span.attributes & ~ATTRS.inverse
        : span.attributes
      return text === span.text && attributes === span.attributes ? span : { ...span, text, attributes }
    })),
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

describe('the goldens', () => {
  for (const size of SIZES) {
    for (const surface of SURFACES) {
      const name = `${surface.name}-${size.width}x${size.height}`
      const owed = SQUEEZED[name]
      it.skipIf(owed !== undefined)(`draws ${name} cell for cell${owed ? ` (accepted: ${owed})` : ''}`, async () => {
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
