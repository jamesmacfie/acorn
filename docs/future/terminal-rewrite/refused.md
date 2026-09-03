# Terminal rewrite: what was refused

Decided 2026-09-03. Each entry says what was considered, why it was refused, and what would reopen it.
The point of the file is that the next person argues with the reasoning and not with silence.

## A Rust or Go painter behind a wire

Considered: ratatui or gocui or bubbletea, receiving the tree protocol from Solid in Node over a pipe,
sending key and mouse events back. The desktop shell is already Rust, so the toolchain exists.

Refused because every handler, every query, every plugin, and the whole kit are TypeScript and run in
Node regardless. The compiled side would be a painter and a key forwarder. It gains nothing from
owning focus, because focus roles and intents are the kit's and live in client-core. It writes the 75
node renderers a second time in a second language. It ships two runtimes where one is enough, and adds
a serialization step on every frame that in-process code does not need. And it does not deliver the
one property the reference apps have that we lack, model and paint in one compiled process, because
the model is still Node. The tree protocol makes this route *possible*, which is a good thing to know
and a reason the protocol exists. It does not make it good.

Reopens if client-core moves out of TypeScript, which nothing plans.

## Running the terminal client under Bun

Considered: OpenTUI is Bun-first, and under Bun the FFI needs no flag and the Solid preload works.

Refused because `apps/tui/src/plugins/workerFactory.ts` runs each loaded plugin in a
`node:worker_threads` worker under Node's permission model with `--allow-fs-read` for exactly two
paths, and `apps/tui/src/plugins/pluginWorker.js` uses `module.registerHooks` to refuse fourteen
builtins. Bun has neither. The containment claim in [security.md](../../security.md) § The
containment ladder rung 0 would have to be re-established from nothing. It also puts a second runtime
into every shipped artifact, which is the problem this programme removes, not one it trades for.

Reopens if Bun ships a permission model equivalent to Node's, and even then only as a comparison.

## Staying on OpenTUI and upstreaming the fixes

Considered: the three monkeypatches and the render guard are well understood; upstream them and
wait for a release that clamps sizes and ties destruction to ownership.

Refused as the strategy, not as a courtesy. Upstreaming the `NaN` clamp is worth doing anyway.
But the faults in [review.md](./review.md) § 2 are properties of a retained renderable with its own
lifecycle and its own focus, and no fix to a specific throw changes that. The Solid destroy race is a
consequence of how `@opentui/solid` chooses to spell removal, and a fix there would have to know about
Solid's ownership graph, which is not the reconciler's business. The two-owner focus problem cannot be
upstreamed at all, because the renderer owning focus is the design. And the runtime floor is a fact
about `node:ffi`, not about OpenTUI.

Reopens if OpenTUI ships a pure-JavaScript renderer path and a focus model the host can own. Neither
is on its roadmap at 2026-09-03.

## Our own key dispatcher in place of `@opentui/keymap`

Considered: once the store owns focus, a dispatcher that walks the tiers and calls the focused stop's
handler is a few hundred lines, and it would remove the last `@opentui` package from the client.

Parked. The engine is pure TypeScript with no runtime floor, the desktop drives the same engine
through its HTML adapter via `packages/client-core/src/kit/keys/keymapHost.ts`, and the twin
`keys.test.tsx` suites are how the two hosts' keyboards are kept from drifting. Replacing it on one
host is a second set of dispatch semantics to keep in step by hand. Its two known costs, the
active-key cache turning off under runtime matchers and the registration-order tie-break that tier 41
exists for, are both fixable through its own API, and
[performance.md](../../performance.md) § 2026-09-03 — phase 9
measures the first. Reopens if a measured keystroke cost is the engine's and cannot be fixed inside
it, or if the desktop leaves the engine.

## Ink, blessed, neo-blessed, terminal-kit

Considered as the "use an existing TypeScript framework" rung.

Ink is React, re-runs Yoga on every state change, builds a full character array, and erases and
rewrites lines through log-update, which is its flicker source. It is the right tool for a
command-line tool's output and the wrong one for a full-screen application. blessed is unmaintained
since 2016; neo-blessed is a maintenance fork; terminal-kit has a document model but its widget set is
its own and none of it is the kit. Adopting any of them means the same adapter work as owning the
paint, plus a second opinion about what a node is.

Reopens never, unless one of them becomes something it is not.

## A constraint layout instead of Yoga

Considered: ratatui's `Length`, `Percentage`, `Min`, `Max`, `Fill` are simpler than flexbox and rule
out the shrink-interleaving fault by construction.

Parked, not refused. 153 `<box>` elements already say `flexDirection`, `flexGrow`, and `gap`, and
OpenTUI computes them with Yoga, so the same engine is what lets the phase 0 golden frames match
cell for cell and lets the layouts port without a redesign. The no-shrink rule in
[tui.md](../../tui.md) § What the TUI never does is a rule about flex and would become a non-issue
under constraints, which is the argument for revisiting. Revisit after phase 4, when the layout pass
is one function in one file and the cost of flex, if there is one, can be measured.

## Our own terminal emulator for the pty rectangle

Considered: OpenTUI's embedded emulator is Ghostty's, in Zig, and it is good.

Refused because `@xterm/headless` is already a dependency of three packages, runs in Node with no
native code, exposes its cell buffer with colours and attributes, and is the same emulator the desktop
draws the same PTY with, so what a reader sees in `acorn` and in the app is produced by the same
parser. Writing one is months; wiring this one is days.

Reopens if xterm's headless build loses the buffer API or the desktop moves off xterm.

## Virtualizing every list as part of this programme

Considered: 39 of 42 `Rows` sites build every row, and the new painter is a chance to window them all.

Refused because `virtual` changes the box's flex so the list grows into its panel, and a short list
would stretch. That is [performance.md](../../performance.md)'s decision and it stands.
Windowing the long sites and the diff pane is
[performance.md](../../performance.md) § 2026-09-03 — phase 9,
done after phase 4 against the new painter.

## A `tui` surface, a per-host prop, or a new kit node

Considered every time a component is hard to draw in cells.

Refused, as [tui.md](../../tui.md) § What the TUI never does already says. This programme changes
what is under the kit and nothing in it. A pane that needs something the kit lacks asks the kit, and
the kit answers for both hosts or refuses for both.

## Copying the reference apps' key tables

Considered: lazygit's and gh-dash's bindings are what readers know.

Refused as a wholesale copy because every key here is an intent first
(`packages/client-core/src/kit/keys/intents.ts`), the intent table is shared with the desktop, and a
key that meant something a desktop intent does not is a second keymap. Phase 5 takes up the
conventions one at a time against that rule: a convention that maps onto an existing intent is a host
key for it, the way Tab is a host key for `nextRegion`; one that does not is refused there.

## Fixing startup in this programme

Considered because lazygit starts in tens of milliseconds and `acorn` does not.

Refused because the cost is booting client-core under Node, and
[performance.md](../../performance.md) § 2026-09-03 — phase 4
owns it and has already moved the first draw to 67 ms attached. Removing OpenTUI's 1.5 MB entry from
the eager graph will help and phase 4 measures it, but the programme does not promise a number.
