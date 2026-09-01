/** @jsxImportSource @opentui/solid */
import { afterEach, describe, expect, it } from 'vitest'
import { hasFfi } from './ffi'
import { renderFixture } from './harness'
import { fixtureBadgePresses } from './fixtureExtensions'

// What another plugin reaches inside this one's surfaces, on the real shell
// (docs/plugins.md § Cooperative extension points, docs/tui.md § What a plugin loses here).
//
// Its own file rather than a case in ./panes.test.tsx, for the reason ./browseLong.test.tsx and
// ./diffLong.test.tsx are their own files: each of these needs an environment flag set before the
// shell's composition root runs, and the query cache is module state that outlives a render, so a
// pane a neighbouring case loaded is the one this case would get.

afterEach(() => {
  delete process.env.ACORN_FIXTURE_BADGE
  delete process.env.ACORN_FIXTURE_DIFF_MARK
  delete process.env.ACORN_FIXTURE_PLUGIN_CHORD
  fixtureBadgePresses.length = 0
})

/** Every run drawn in the focused form, as ./controls.test.tsx reads them. */
const litRuns = async (screen: { spans: () => Promise<{ text: string; fg: { r: number; g: number; b: number }; attributes: number }[][]> }): Promise<string[]> =>
  (await screen.spans()).flat()
    .filter((run) => run.text.trim() && run.fg.r < run.fg.g && (run.attributes & 1) === 1)
    .map((run) => run.text)

describe.skipIf(!hasFfi)('a contribution inside somebody else’s surface', () => {
  // The keyboard contract for extension content, and the whole of requirement 9: content in a remote
  // slot is as reachable as the kit nodes it draws, inside the region its host registered. The slot
  // sits above github's own action toolbar in the Details panel, so a contributed button is that
  // panel's first stop and the merge `Select` becomes its second.
  it('draws a contributed button as a stop, reached with Down and pressable', async () => {
    process.env.ACORN_FIXTURE_BADGE = 'button'
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      expect(await screen.until('Deploy fixture', 45)).toContain('Deploy fixture')
      await screen.press('TAB')
      await screen.press('ARROW_DOWN')
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toContain('[Deploy fixture]')

      await screen.press('RETURN')
      expect(fixtureBadgePresses).toContain('deploy')

      // …and the panel carries on past it, to github's own first control.
      await screen.press('ARROW_DOWN')
      expect(await litRuns(screen)).toContain('[ squash ▾ ]')
    } finally {
      screen.done()
    }
  }, 180_000)

  it('draws a contributed line that is not a stop, and Down goes straight past it', async () => {
    process.env.ACORN_FIXTURE_BADGE = 'text'
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      expect(await screen.until('fixture says staging', 45)).toContain('fixture says staging')
      await screen.press('TAB')
      await screen.press('ARROW_DOWN')
      await screen.press('ARROW_DOWN')
      // The panel's first stop is github's own, exactly as it is with no contribution at all: a `Text`
      // is not a stop on either host and a contributor cannot make one (focusRoles.ts).
      expect(await litRuns(screen)).toContain('[ squash ▾ ]')
    } finally {
      screen.done()
    }
  }, 180_000)

  // Requirement 7: a mark is text about one line, and it changes nothing about how the diff is
  // driven. 160 by 40 because that is the size the diff column draws at (./diffLong.test.tsx).
  it('draws another plugin’s mark under the diff line it is about', async () => {
    process.env.ACORN_FIXTURE_DIFF_MARK = '1'
    const screen = await renderFixture({ pane: 'pr', width: 160, height: 40 })
    try {
      const lines = (await screen.until('uncovered', 45)).split('\n')
      const at = lines.findIndex((line) => line.includes('uncovered'))
      expect(at).toBeGreaterThan(0)
      // Directly under the line it keys — the first insert of the fixture patch, new line 2 — and
      // stamped with the plugin that said it. The code itself is clipped at the column's edge, which
      // is the diff behaving: a patch line is `wrapMode="none"` and wider than the panel, and it is
      // why the mark goes under the line rather than after it (./kit/showing.tsx § AnnotatedDiffLine).
      expect(lines[at - 1]).toMatch(/2 \+ {2}const account = await loadAccountByEmailAddress/)
      expect(lines[at]).toContain('fixture')
      // …and on that line only. The second insert is not marked and does not gain a line.
      expect(lines.filter((line) => line.includes('uncovered'))).toHaveLength(1)
    } finally {
      screen.done()
    }
  }, 180_000)

  // Requirement 13. A manifest chord carries a command modifier, and the desktop's is `meta`, which
  // `toKeymapKey` spells `super` and `asCtrl` rewrites to `ctrl` — so `meta+ctrl+alt+shift+d` reaches
  // the engine as `ctrl+ctrl+meta+shift+d`. The parser reads modifiers into flags, so the repeat is
  // one flag and no dedupe is owed; what a reader presses is Ctrl+Option+Shift+D
  // (./keys/commandLayer.ts, docs/plugin-authoring.md § Keybindings).
  it('fires a plugin’s own chord, with the command key read as Ctrl', async () => {
    process.env.ACORN_FIXTURE_PLUGIN_CHORD = '1'
    const screen = await renderFixture({ pane: 'pr', width: 100, height: 32 })
    try {
      await screen.until('#42', 45)
      await screen.press('d', { ctrl: true, meta: true, shift: true })
      expect(fixtureBadgePresses).toContain('chord')
    } finally {
      screen.done()
    }
  }, 180_000)
})
