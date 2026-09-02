# Terminal keyboard: how to test it

Guide, 2026-09-02. For the developer writing a phase. `docs/testing.md § Test layers` owns the
repo-wide picture; this file is the terminal keyboard's corner of it, with the traps named.

## The floor

OpenTUI's render core is Zig behind `node:ffi`, a Node 26.4 builtin behind `--experimental-ffi`.
`apps/tui/vitest.config.ts` passes the flag on Node 26.4 and up. Every test that draws is wrapped in
`describe.skipIf(!hasFfi)` (`apps/tui/src/ffi.ts`), so on an older Node the suite reports green
with no rendering test run.

Before trusting a green run, read the summary line. At the baseline commit a full run is 31 files
and 270 tests. A run that says 31 files and about 40 tests skipped everything that matters.

```sh
node --version                       # 26.4 or later
pnpm --filter @acorn/tui test        # the whole suite, about two and a half minutes
pnpm --filter @acorn/tui test -- keys  # one file by name fragment
ACORN_TUI_WIDE=1 pnpm --filter @acorn/tui test -- reachability   # both sizes, twice as long
```

Use `pnpm test` for the whole repo rather than `turbo run test`; the latter has no concurrency
bound and the tests that spawn processes time out under load (`CLAUDE.md`).

## How a key gets pressed in a test

Both harnesses press keys the way a terminal does. `mockInput.pressKey(key, modifiers)` from
`@opentui/core/testing` encodes the key and emits the bytes on the renderer's `stdin`. The engine
subscribes to the same stream. So a test press goes through parse, intercepts, layers, and the
focused renderable exactly as a real one does. Three things differ:

- **Kitty only.** Both harnesses pass `kittyKeyboard: true`, so only the kitty CSI-u encoding is
  exercised. A terminal that does not negotiate it sends different bytes for Shift+Tab (`ESC [ Z`),
  and nothing in the suite can press that. Check it by hand in such a terminal.
- **A fixed wait.** `press()` waits 80 ms after the bytes (`KEY_SETTLE_MS` in `kit/render.tsx`,
  the same literal in `harness.tsx`). It stands in for the terminal's escape-sequence timer. The
  rectangle's 400 ms Escape pair is approximated, not driven.
- **Named keys are spelled OpenTUI's way, upper case.** `'RETURN'`, `'ESCAPE'`, `'TAB'`, `'F6'`,
  `'PAGEDOWN'`, `'UP'`. Anything else is typed one character at a time, silently. `'Enter'` types
  five letters.

## The two harnesses

**`kit/render.tsx` `renderCells(() => <Tree/>, { width, height })`** draws a kit tree with no shell.
Use it for a control, a collection, a modal, a viewport. It returns `Cells`:

- `frame()` renders and returns `{ text, lines, runs }`.
- `press(key, modifiers?)` presses and returns the next frame.
- `done()` tears down and resets the four registries.

`caretRow(lines)` in the tests finds the `›` glyph's row, or `-1`.

**`harness.tsx` `renderFixture({ width, height, pane })`** boots the fixture node
(`fixture.ts`), the shell, and the plugins. Use it for anything about regions, the rail, the pane
strip, or a plugin pane. It returns `Screen`:

- `frame()`, `press()`, `done()` as above.
- `caret()` returns `{ region, text }` for what has the keys.
- `walk(steps, each)` presses `steps` and calls `each` after every press; returning `true` stops.
- `reach(text)` walks until a line containing `text` has the caret.
- `renderer` is the OpenTUI renderer, for `currentFocusedRenderable`.

`ACORN_FIXTURE_DELAY_MS=50` makes the fixture node answer slowly, which is the only way to reach
a suspension bug (`browseSlow.test.tsx` is the model; see `docs/tui.md § Destroy on disposal`).

## The property, and how to add to it

`reachability.test.tsx` is one property over the roster rather than a scenario per bug. For each
surface in `SURFACES` and each size in `SIZES`, it walks Tab-major and Down-minor and asks the
invariants after every press. The walk treats a repeated node or an already-seen node as "region
done", because a wrapping collection answers Down forever.

To add a pane: add its row to `SURFACES` with the `pane` id and an `until` string that appears
only when the pane has drawn, and add it to `panes.test.tsx` in the same change. A failure names
the surface, the size, and the line it could not reach, and pressing the same keys in the same
order reproduces it.

To add an invariant: add it to the `check` function that runs after every press. Phase 0 adds the
agreement check there.

To add an overlay surface: open the overlay in the surface's setup (a chord through `press`) and let
the walk run. The walk stays inside the scope or invariant 10 fails.

## Writing a scenario that is supposed to fail

Phase 0 writes the six symptom scenarios before any fix exists. Vitest's `it.fails` inverts the
result: the case passes while the assertion fails and turns red the day the assertion holds. That
red is the signal to delete `.fails` and, once the phase lands, to promote the case into the
permanent file it belongs in. A `.fails` that survives its phase is a bug in the phase.

```ts
it.fails('tab stays inside a modal', async () => {
  const screen = await renderFixture({ width: 80, height: 24 })
  try {
    await screen.press('?')                     // the cheat sheet, a Modal
    const before = screen.renderer.currentFocusedRenderable
    await screen.press('TAB')
    const after = screen.renderer.currentFocusedRenderable
    expect(within(modalBox(screen), after)).toBe(true)
  } finally { screen.done() }
})
```

Two rules for these: assert on `renderer.currentFocusedRenderable` and on the cell buffer, never
only on the store's signal, and put the reproduction in the test name so a red one reads as a bug
report.

## The unit half

`keys/regions.test.ts` tests the region store with fake renderables and no renderer. At the baseline
its fakes have `focus() {}`, so they accept every focus, and the one thing the real renderer does
that matters (refuse a non-focusable node) cannot happen in them. Phase 1 gives the fakes
`focusable`, a `focus()` that honours it, and a fake renderer that emits `focused_renderable`. From
then on a unit test here is trustworthy about landing, and `regions.test.ts` becomes properties over
`ensureFocus` in phase 3.

`invariants.test.ts` is greps: one `queueMicrotask` in `keys/`, none in `kit/`, no `super+` where
the host cannot press it. Phases 1 and 5 add greps there. A grep invariant is cheap and is the right
tool for "this may appear in one file only".

## Seeing focus in a running app

```sh
ACORN_TUI_KEYS_TRACE=1 pnpm --filter @acorn/tui dev
tail -f ~/.local/state/acorn/keys.log
```

One line per key: the parsed key, the engine's reason (`intercept-consumed`, `binding-handled`,
`binding-rejected`, `no-match`), the focused renderable, its region, the scope depth, and whether
the renderer and the store agree. `agree=no` is a bug. `reason=no-match` on a key the footer
offers is a bug. `region=none` while the screen has regions is a bug. Lands in phase 0.

`pnpm --filter @acorn/tui capture` prints the cell buffer with no TTY, for a screenshot in a bug
report.

## Checks that are not tests

- Shift+Tab in a terminal without the kitty protocol. By hand.
- The trust prompt at boot against a real node with a real unsigned bundle. The harness stubs
  `pendingTrust`; the real flow goes through custody.
- A PTY entered, then a notification activates another task. By hand, with the trace on.
