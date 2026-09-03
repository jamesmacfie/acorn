/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from 'solid-js'
import { describe, expect, it } from 'vitest'
import type { PluginTrustRequest } from '@acorn/client-core/host/plugins/distribution.ts'
import { hasFfi } from '../ffi'
import { renderFixture } from '../harness'
import { activeHints } from '../chrome/bindings'
import { renderCells } from '../kit/render'
import { Modal, ModalBody, TabPanel, Tabs } from '../kit/grouping'
import { Rectangle } from '../kit/pixels'
import { enteredRectangle, type CellTerminal } from '../kit/rectangle'
import { Row, Rows } from '../kit/showing'
import { Text } from '../kit/showing'
import { Button, Input } from '../kit/asking'
import { HeaderBodyFooter } from '../layouts/HeaderBodyFooter'
import { focusedRegion, focusedRenderable, onScreen, regionFocus } from './regions'

// The terminal twin of `client-core/host/keys/keys.test.tsx`: the same intent scenarios against the
// terminal adapter, so the two adapters cannot drift.
//
// A cell host has no tree to query, so a scenario is written as "press this, look at the screen".
// That is stricter than asking the DOM which element has focus, and it is the same discipline the
// kit's own suite keeps.

const LIST = [
  { key: 'one', label: 'Alpha' },
  { key: 'two', label: 'Bravo' },
  { key: 'three', label: 'Charlie' },
]

/** Which line the caret is on. The caret is where the keys are, so this is the whole assertion for
 *  every move intent. */
const caretRow = (lines: string[]) => lines.findIndex((line) => line.includes('›'))

function List(props: { onActivate?: (key: string) => void }) {
  return (
    <Rows id="test-list" items={LIST} {...(props.onActivate ? { onActivate: props.onActivate } : {})}>
      {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
    </Rows>
  )
}

/** Which line the caret is on, as the line itself, for a case that cares which row it landed on. */
const caretLine = (lines: string[]): string => lines.find((line) => line.includes('\u203a')) ?? ''

// A bundle this device has never decided about, as the distribution queue holds one. The manifest is
// the smallest one `trustTiers` can describe: a version, no permissions, no contributions.
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

describe.skipIf(!hasFfi)('keys and focus in cells', () => {
  it('lands the keys on the list when a pane opens, and moves them with next and prev', async () => {
    const frame = await renderCells(() => (
      <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List /> }} />
    ), { width: 40, height: 10 })
    try {
      // Something has the keys before anything is pressed: a terminal has no pointer, so a pane that
      // opens with focus nowhere is a pane nobody can drive (./regions.ts § regionFocus).
      const first = caretRow(frame.lines)
      expect(first).toBeGreaterThanOrEqual(0)

      // `j` is `next` in the one table both hosts read (client-core kit/keys/keymap.ts).
      expect(caretRow((await frame.press('j')).lines)).toBe(first + 1)
      expect(caretRow((await frame.press('k')).lines)).toBe(first)
      // Wraps, because a list you cannot fall off the end of is a list you never have to look at.
      expect(caretRow((await frame.press('k')).lines)).toBe(first + LIST.length - 1)
      // `g` is `first` and `shift+g` is `last`.
      expect(caretRow((await frame.press('g')).lines)).toBe(first)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('routes activate to the row the caret is on', async () => {
    const [opened, setOpened] = createSignal('')
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List onActivate={setOpened} /> }} />
        <Text>{`opened:${opened()}`}</Text>
      </>
    ), { width: 40, height: 10 })
    try {
      await frame.press('j')
      const after = await frame.press('RETURN')
      expect(after.text).toContain('opened:two')
    } finally {
      frame.done()
    }
  }, 30_000)

  it('cycles the regions of a pane, and each remembers where it was', async () => {
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          header: () => <Rows id="header-list" items={[{ key: 'h', label: 'Header row' }]}>
            {(item, itemProps) => <Row item={itemProps}>{item.label}</Row>}
          </Rows>,
          body: () => <List />,
        }}
      />
    ), { width: 40, height: 10 })
    try {
      // The header registers first, so it opens with the keys.
      expect(frame.lines[caretRow(frame.lines)]).toContain('Header row')
      // `f6` is `nextRegion`, the platform convention, on layer 5 and global.
      const body = await frame.press('F6')
      expect(body.lines[caretRow(body.lines)]).toContain('Alpha')
      const back = await body.press('F6')
      expect(back.lines[caretRow(back.lines)]).toContain('Header row')
    } finally {
      frame.done()
    }
  }, 30_000)

  it('keeps next inside a modal, on both of this host\'s keys for it, and dismiss closes it', async () => {
    const [open, setOpen] = createSignal(false)
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter stateKey="pane" label="Test" regions={{ body: () => <List /> }} />
        <Show when={open()}>
          <Modal onDismiss={() => setOpen(false)} title="Ask"><ModalBody><Text>a question</Text></ModalBody></Modal>
        </Show>
      </>
    ), { width: 40, height: 12 })
    try {
      const before = caretRow(frame.lines)
      expect(before).toBeGreaterThanOrEqual(0)

      // A modal lands the keys as well as containing them, so the caret leaves the list behind it
      // (./regions.ts § pushScope). One that only contained them left the reader looking at a dialog
      // whose every key the trap then swallowed.
      setOpen(true)
      const up = await frame.frame()
      expect(up.text).toContain('a question')
      expect(caretRow(up.lines)).toBe(-1)

      // Nothing behind the modal answers `nextRegion` either, and that is the whole meaning of modal
      // on a host with no scrim: with the modal's box on the scope stack no region is in scope, so
      // the region cycle has nowhere to go (./regions.ts § Scopes).
      //
      // Both keys, because on this host `f6` and `tab` are the same intent (./install.ts § HOST_KEYS)
      // and the swallow this replaced contained only one of them. It named its keys from the shared
      // table, where `nextRegion` is `f6` alone, so Tab walked the keys onto the list behind the
      // dialog. That is the whole of symptom A (../symptoms.test.tsx).
      for (const key of ['F6', 'TAB']) {
        const held = await frame.press(key)
        expect(held.text, key).toContain('a question')
        expect(caretRow(held.lines), key).toBe(-1)
      }

      const closed = await frame.press('ESCAPE')
      expect(closed.text).not.toContain('a question')
      // And the pane has the keys back, on the row it had them on.
      expect(caretRow(closed.lines)).toBe(before)
      expect(caretRow((await frame.press('j')).lines)).toBe(before + 1)
    } finally {
      frame.done()
    }
  }, 30_000)

  // ── A dialog holds the keys because nothing outside it is in scope ──────────────────────────
  //
  // The two cases below drive the whole shell rather than one node, because the fault they prevent
  // was in what the shell and the store said to each other about the dialog. A trap used to contain
  // the keys by swallowing a named list of them, and the list it named came from `keysFor()`, where
  // `nextRegion` is `f6` alone, while `install.ts` binds `hostKeysFor()`, which adds `tab` for this
  // host. So Tab was swallowed nowhere: it walked the keys onto a rail row behind the dialog and the
  // swallow then ate everything but Escape, which made the one key the footer advertised the one key
  // that broke the dialog. A dialog is a scope now, so nothing behind it is in the universe a walk
  // sees, and there is no list to leak (./regions.ts § Scopes, ./trap.ts).

  it('answers the plugin trust prompt after a Tab', async () => {
    const screen = await renderFixture({ width: 100, height: 28, trust: [TRUST] })
    try {
      const up = await screen.until('Run board?')
      expect(up).toContain('Run it')
      // Anti-vacuity: the dialog is real and its choices answer their own arrows.
      await screen.press('j')
      expect(caretLine((await screen.frame()).split('\n'))).toContain("Don't run it")
      const before = screen.renderer.currentFocusedRenderable
      const region = focusedRegion()

      // Both halves are asserted, because the renderer used to recover and that is what made this
      // hard to see. The walk moved the keys onto a rail row behind the dialog and the next landing,
      // which a query arriving supplies sooner or later, handed them back. What never recovered is
      // the store's idea of which region has them, so the region had silently moved to the rail while
      // the keys were in the dialog.
      await screen.press('TAB')
      expect(screen.renderer.currentFocusedRenderable).toBe(before)
      expect(focusedRegion()).toEqual(region)

      // And the footer never offers the key that did this. It reads the store's count of regions in
      // scope rather than asking the engine whether Tab is bound, because the region layer is still
      // registered and the engine still reports it live (../chrome/bindings.ts).
      expect(activeHints().map((hint) => hint.keys)).not.toContain('tab')
    } finally {
      screen.done()
    }
  }, 60_000)

  it('keeps the keys inside the quit confirmation when Tab is pressed', async () => {
    // The same hole as the trust prompt, seen from the other side and with no plugin in it: the quit
    // confirmation is a list inside a `Modal` and nothing else.
    const screen = await renderFixture({ width: 100, height: 28, supervised: true })
    try {
      await screen.press('q')
      const up = await screen.until('Quit and stop the node')
      expect(up).toContain('Quit and stop the node')
      const before = screen.renderer.currentFocusedRenderable
      const region = focusedRegion()

      await screen.press('TAB')
      expect(screen.renderer.currentFocusedRenderable).toBe(before)
      expect(focusedRegion()).toEqual(region)
      expect(activeHints().map((hint) => hint.keys)).not.toContain('tab')
    } finally {
      screen.done()
    }
  }, 60_000)

  it('offers Tab only where Tab goes somewhere', async () => {
    // The footer used to advertise a key that did nothing. `moveRegion` returns false with fewer than
    // two regions in scope, and the hint was drawn from "is Tab bound", which it always is. The hint
    // asks the store how many regions the keys can reach instead, so a one-region screen does not
    // offer it. The case is a disjunction because either answer is honest: Tab may move, or the
    // footer may stay quiet, and only offering it while it does nothing is the bug
    // (../chrome/bindings.ts, ./regions.ts § regionsInScope).
    const screen = await renderFixture({ width: 100, height: 28 })
    try {
      await screen.until('Invalidate')
      // `ctrl+b` hides the whole rail, which on a browse screen leaves one region.
      await screen.press('b', { ctrl: true })
      await screen.frame()

      const before = screen.renderer.currentFocusedRenderable
      await screen.press('TAB')
      const moved = screen.renderer.currentFocusedRenderable !== before
      const offered = activeHints().some((hint) => hint.keys === 'tab')
      expect(moved || !offered, 'the footer offers tab and tab does nothing').toBe(true)
    } finally {
      screen.done()
    }
  }, 60_000)

  it('a pty rectangle takes the keys on enter and gives them back on escape', async () => {
    let terminal: CellTerminal | undefined
    const typed: string[] = []
    const frame = await renderCells(() => (
      <>
        <HeaderBodyFooter
          stateKey="pane"
          label="Test"
          regions={{
            header: () => <List />,
            body: () => <Rectangle kind="pty" label="Terminal" mount={(handle) => {
              terminal = handle as unknown as CellTerminal
              terminal.onData((bytes) => typed.push(new TextDecoder().decode(bytes)))
            }} />,
          }}
        />
      </>
    ), { width: 40, height: 20 })
    try {
      expect(terminal).toBeDefined()
      // Bytes from the PTY are drawn by a real emulator in cells, which is the thing a terminal does
      // better than the desktop (../kit/rectangle.tsx).
      terminal!.write('hello from the shell')
      expect((await frame.frame()).text).toContain('hello from the shell')

      // The header registers first, so the list opens with the keys and `j` is its.
      const before = caretRow(frame.lines)
      expect(caretRow((await frame.press('j')).lines)).toBe(before + 1)

      // The rectangle is one stop from outside; `f6` reaches it and Enter goes in.
      await frame.press('F6')
      const inside = await frame.press('RETURN')
      expect(inside.text).toContain('esc leave')

      // Inside, every key is the PTY's, including the ones the app would otherwise claim.
      await frame.press('j')
      await frame.press('F6')
      expect(typed.join('')).toContain('j')
      // The caret is gone from the list, because the keys are not the list's any more. That is the
      // visible half of the same fact.
      expect(caretRow((await frame.frame()).lines)).toBe(-1)

      // Escape alone leaves; Escape again goes back in and sends one through, which is how a reader
      // reaches vim's normal mode from in here (../kit/rectangle.tsx, ESCAPE_PAIR_MS).
      const out = await frame.press('ESCAPE')
      expect(out.text).toContain('\u00b7 enter')
      const again = await frame.press('ESCAPE')
      expect(again.text).toContain('esc leave')
      expect(typed.join('')).toContain('\u001b')

      // And the list has its place back when the keys come back to it, because a region remembers
      // where it was (./regions.ts).
      await frame.press('ESCAPE')
      const listed = await frame.press('F6')
      expect(caretRow(listed.lines)).toBe(before + 1)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('a pty rectangle tells the PTY its size, and again when the terminal is resized', async () => {
    let terminal: CellTerminal | undefined
    const sizes: [number, number][] = []
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          body: () => <Rectangle kind="pty" label="Terminal" mount={(handle) => {
            terminal = handle as unknown as CellTerminal
            terminal.onResize((cols, rows) => sizes.push([cols, rows]))
          }} />,
        }}
      />
    ), { width: 40, height: 12 })
    try {
      expect(terminal).toBeDefined()
      await frame.resize(100, 30)
      // The renderer handles `SIGWINCH` itself and re-lays out; this is how that reaches the PTY, and
      // it is the only resize path there is (docs/tui.md § Signals and exit).
      expect(sizes.length).toBeGreaterThan(0)
      expect(sizes[sizes.length - 1][0]).toBeGreaterThan(40)
    } finally {
      frame.done()
    }
  }, 30_000)

  // ── An entered rectangle that goes off screen ───────────────────────────────────────────────
  //
  // Being entered used to be a flag, set by Enter and cleared by Escape or by unmounting. Neither of
  // those happens when a subtree is hidden without being unmounted, which is what a tab switch and
  // an overlay both do here, so a rectangle nobody could see went on consuming every key in the app,
  // `Ctrl+C` included, since the intercept sits above every layer there is. It is a derived fact now:
  // entered means the box has the keys, is on screen, and Enter was pressed since it last lost them,
  // so the answer changes the moment the screen does and there is no flag to be stale
  // (../kit/rectangle.tsx § entered).

  it('stops taking the keys the moment an entered rectangle goes off screen', async () => {
    const [shown, setShown] = createSignal(true)
    const typed: string[] = []
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          header: () => <List />,
          body: () => (
            <box visible={shown()} flexGrow={1} flexDirection="column">
              <Rectangle kind="pty" label="Terminal" mount={(handle) => {
                const terminal = handle as unknown as CellTerminal
                terminal.onData((bytes) => typed.push(new TextDecoder().decode(bytes)))
              }} />
            </box>
          ),
        }}
      />
    ), { width: 40, height: 16 })
    try {
      await frame.press('F6')
      const inside = await frame.press('RETURN')
      expect(inside.text).toContain('esc leave')
      typed.length = 0

      // Hidden from outside the keyboard, and by a bare `visible` that asks for nothing else: this is
      // the intercept's own guard, with no landing pass involved. `visible` is per node in OpenTUI,
      // so the box below still reports itself focused and visible, and asking it alone was the bug.
      setShown(false)
      await frame.frame()
      await frame.press('j')
      expect(typed.join('')).not.toContain('j')
      // And the footer stops telling the reader to press Escape at a box nobody can see
      // (../chrome/Footer.tsx).
      expect(enteredRectangle()).toBe(false)
    } finally {
      frame.done()
    }
  }, 30_000)

  it('gives the keys back when the tab an entered rectangle sits on is switched', async () => {
    // The path a reader actually meets: a terminal on one tab of a pane, entered, and the tab
    // switched by something other than the keyboard, such as a route change or a task activating
    // from a notification. `TabPanel` hides its panel rather than unmounting it so the panel keeps its
    // state, so the hidden rectangle keeps the renderer's focus, and a viewport whose flag has gone
    // false asks for a landing pass for exactly this reason (../kit/scrolling.tsx).
    const [tab, setTab] = createSignal('term')
    const typed: string[] = []
    const frame = await renderCells(() => (
      <HeaderBodyFooter
        stateKey="pane"
        label="Test"
        regions={{
          body: () => (
            <>
              <Tabs
                idPrefix="rect"
                ariaLabel="Panes"
                active={tab()}
                onChange={setTab}
                tabs={[{ id: 'term', label: 'Terminal' }, { id: 'list', label: 'List' }]}
              />
              <TabPanel idPrefix="rect" id="term" active={tab()}>
                <Rectangle kind="pty" label="Shell" mount={(handle) => {
                  const terminal = handle as unknown as CellTerminal
                  terminal.onData((bytes) => typed.push(new TextDecoder().decode(bytes)))
                }} />
              </TabPanel>
              <TabPanel idPrefix="rect" id="list" active={tab()}>
                <List />
              </TabPanel>
            </>
          ),
        }}
      />
    ), { width: 44, height: 18 })
    try {
      // The strip is a parent stop, so entry lands on it and Down goes into the panel it is showing,
      // which is the rectangle's door.
      const door = await frame.press('ARROW_DOWN')
      const inside = await door.press('RETURN')
      expect(inside.text).toContain('esc leave')
      typed.length = 0

      setTab('list')
      await frame.frame()
      // Invariant 6 of a hidden subtree: the keys are not on a node the reader cannot see. The
      // landing rule walks the parents before it decides, so the only thing the hidden panel had to
      // do was ask for a pass (./regions.ts § The landing rule).
      expect(onScreen(focusedRenderable())).toBe(true)

      // And the key belongs to the app again. Down from the strip enters the panel that is showing
      // now, which is the list.
      const moved = await frame.press('j')
      expect(typed.join('')).not.toContain('j')
      expect(caretLine(moved.lines)).toContain('Alpha')
    } finally {
      frame.done()
    }
  }, 30_000)
})

// ── Typing is a layer ─────────────────────────────────────────────────────────────────────────
//
// While a field has the keys the bare keys type, and this host says so once, as a layer registered
// while a field has them, rather than as a matcher on every bare-key binding on the screen. The
// behaviour is the same and the engine's own active-key cache is the difference
// (./tiers.ts § TYPING, ../chrome/bindings.ts).

/** How many layers, commands or bindings are keeping the engine's active-key cache off.
 *
 *  Read off the engine's own state through its extension symbol, because 0.5.9 publishes no stats
 *  API. That is a test of another package's internals and it is worth the ceiling here: the whole
 *  point of the typing shadow is this number, and a release that renames it should fail loudly rather
 *  than let the design quietly stop paying (`@opentui/keymap` § createKeymapState). */
const cacheBlockers = (engine: object): number => {
  const symbol = Object.getOwnPropertySymbols(Object.getPrototypeOf(engine))
    .find((candidate) => String(candidate).includes('keymap-extension-context'))
  expect(symbol, 'the keymap no longer exposes its extension context').toBeDefined()
  const read = (engine as Record<symbol, () => { state: { activeKeyCacheBlockers: number } }>)[symbol!]
  return read.call(engine).state.activeKeyCacheBlockers
}

describe.skipIf(!hasFfi)('the typing shadow', () => {
  it('lets a bare key reach a field, moves focus with it after the field loses the keys, and blocks no cache', async () => {
    const [text, setText] = createSignal('')
    const [pressed, setPressed] = createSignal('')
    // Two regions, because Tab is how the keys leave a field for something that is not one, and the
    // cycle needs somewhere to go (./regions.ts § moveRegion).
    let screen = await renderCells(() => (
      <box flexDirection="column" flexGrow={1}>
        <box ref={regionFocus({ paneId: 'test', regionId: 'field' }, 0)}>
          <Input value={text()} onInput={setText} />
        </box>
        <box flexDirection="column" ref={regionFocus({ paneId: 'test', regionId: 'buttons' }, 1)}>
          <Button onPress={() => setPressed('first')}>First</Button>
          <Button onPress={() => setPressed('second')}>Second</Button>
        </box>
      </box>
    ), { width: 40, height: 8 })
    try {
      const { keymap } = await import('@acorn/client-core/kit/keys/keymapHost.ts')
      const engine = keymap()!

      // The screen opens on the first region, which is the field: a region lands on its first stop
      // and this one has nothing else (./regions.ts § enter).
      expect(cacheBlockers(engine)).toBe(0)

      // `j` in a field is a `j`. The shadow claims it so that nothing below answers, and hands it to
      // the field anyway, which is what `preventDefault: false` buys.
      screen = await screen.press('j')
      expect(text()).toBe('j')
      // And the engine's cache is still on while the shadow is registered, which is the whole reason
      // it is a layer.
      expect(cacheBlockers(engine)).toBe(0)

      // Out of the field, and the same key moves the keys instead of typing.
      screen = await screen.press('TAB')
      screen = await screen.press('j')
      expect(text()).toBe('j')
      screen = await screen.press('RETURN')
      expect(pressed()).toBe('second')
      expect(cacheBlockers(engine)).toBe(0)
    } finally {
      screen.done()
    }
  }, 30_000)
})
