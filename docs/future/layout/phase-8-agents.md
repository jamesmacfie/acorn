# Phase 8: agents

Status: shipped 2026-08-30.

## Goal

Move the agents plugin's surfaces to layouts and kit trees on the direct path: the Agent pane
(sidebar, transcript, composer), Agent Center, and the three settings pages. The transcript becomes a
`Timeline` of cards whose tool cards are `Slot`s (hosted since phase 3), and the composer gains its two
slots. This is the pane the whole programme pays for, and it goes last because it is the largest and
the most performance-sensitive.

## Why this phase, and why now

Every mechanism the transcript needs has been exercised elsewhere: `Timeline` on github's
conversation, `Slot` on the tool card since phase 3, `Composer` on github and linear, `list-detail`
with a `header-body-footer` detail region on docker and context. What is new here is only scale, and
the performance guardrails below exist because of what has gone wrong in this pane before.

## Scope

In: `plugins/agents/src/client/` rewritten against the kit. Behaviour unchanged. The agents CSS
deleted.

Out: the node half, the harness seam, the webhook service, the rail markers (descriptors), attention
sources, node stats, collections.

## Per surface

### Agent pane (`AgentPane`, `AgentTaskSidebar`, `AgentTranscript`, `AgentEventCard`,
`AgentComposer`, `QueuedAgentTurns`, `AgentRequestCard`)

Layout `list-detail`; detail is `header-body-footer`.

- List: `Section` "Needs you" of `Row`s with `tone="warn"`; `Section` "Managed sessions" of `Row`s
  with the provider glyph as `icon`, state as `meta`, `actions` for rename and archive, and subagents
  as indented `TreeRow`s; `Section` "Terminals and workflows" of `Row`s.
- Header: `Heading` with the session title, `StatusDot` for runtime state, a `Menu` of session
  actions, the provider `Picker` for a new session.
- Body: a `Timeline`. Each event is a `Card`: user and assistant messages with `Markdown`; a tool
  call as `<Slot point="tool-card" key={tool.name} props={…}><DefaultToolCard/></Slot>`; a plan as
  a `Card` with a status `Row` list; a subagent as a `Fold` containing its own `Timeline`; usage and
  diagnostics as `Text` with `emphasis="muted"`. Folds seed from the Tool call display setting and
  then hold their own state, as today.
- Footer: `Composer` with `onSubmit`, the context `ChipRow`, the context `Picker` and insert
  `Picker`, `<Slot point="composer-actions" mode="stack" max={4}/>`, and
  `<Slot point="attachment" mode="replace" key={selected?.mime}><AttachmentChip/></Slot>`. Before
  send calls `ctx.hooks.run('before-send')` on the node (phase 4).
- Rename and archive as `Modal` nodes.

Accepted differences: event cards take the kit `Card` spacing; the composer's context chips become
a `ChipRow`; the mention textarea's per-keystroke mention popup becomes the `Composer`'s built-in
mention behaviour (host-owned, so it stays live).

### Agent Center (`AgentCenter`)

Layout `header-body`: `Heading` and stats as `Facts`; provider `Card`s in an `Inline`; a filter
`Toolbar` with `Select` and `Input`; a `Row` collection of sessions.

### Settings (`AgentSessionDefaultsSettings`, `AgentConcurrencySettings`, `AgentPricingSettings`,
`AgentUsageSection`)

`Field`s over `Select`, `Checkbox`, `Table`, and `Meter` in a `Stack`.

### Modals and pickers (`AgentContextPickerModal`, `AgentMentionTextarea`)

`Modal` and `Picker` nodes; the mention textarea folds into `Composer`.

## Performance guardrails

Recorded because this pane has failed before in exactly these ways (see the memory index notes on the
deleted virtualizer, the `on()` dedupe loop, and the `innerHTML` effect).

- **No virtualizer in the transcript.** `Timeline` renders every card; the kit's collection host may
  window rendering only by intersection, never by measuring, and only if the phase-7 `Row`
  collection host has proven it does not flash.
- **A card seeds fold state at mount and then leaves it alone.** Reactive fold state slams a card
  shut when its call finishes.
- **`Markdown` renders once per text change**, not per upstream tick. The node holds a memo of its
  input.
- **Text selection survives streaming.** A test selects text in a rendering card while events append
  and asserts the selection is intact.
- **The `Slot` for a tool card mounts once per call**, keyed by the call id, and patches in place as
  updates arrive; a remount per event is a bug.

## Code touched

- `plugins/agents/src/client/*.tsx` (twenty files per the survey).
- `plugins/agents/src/client/toolRendererRegistry.tsx`: becomes the `agents:tool-card` slot's
  first-party resolver, or is deleted if phase 4's registry covers it.
- The agents CSS: deleted.
- `plugins/agents/src/client/index.ts`: `ctx.panes.register({ layout: 'list-detail', regions })`.

## Tests

- Existing agents client tests pass against the tree version.
- The transcript renders a fixture session of 500 events in the jsdom tier within a budget the test
  fixes, and appending 50 more events does not remount existing cards.
- Text selection survives streaming (above).
- A tool card from a worker-hosted test plugin renders in the transcript; a broken one yields the
  placeholder and the rest of the transcript is intact.
- The composer's `attachment` slot draws the default chip for a `.docx` and a test contributor for a
  `.png`.
- Keyboard: `nextRegion` moves between sidebar, transcript, and composer; `j` and `k` move through
  cards outside the composer; `commit` sends.

## Docs owed

- `docs/managed-agents.md` § "Client surfaces": the layout, the slots, the guardrails.
- `docs/agent-tools.md`: the tool card slot replaces the renderer paragraph.
- `docs/first-party-plugins.md`: agents stays first-party for reasons D and F; reason E's
  `agentToolRenderers` row is gone.

## Doors left open

- No CSS remains in the plugin.
- The transcript is a `Timeline` of kit cards, so a terminal draws it from the same tree.
- Image attachments are the only DOM-only thing in the pane and are behind `Fallback`.

## Done when

- The Agent pane renders through layouts with no raw `div` or `span` and no CSS, and the
  performance tests above pass.
- Every existing flow in the smoke checklist for agents (start, send, attach, approve, rename,
  archive, fork) passes.
- `pnpm lint`, `pnpm test`, and the desktop boot test are green.

## Verify before building

- `plugins/agents/src/client/AgentPane.tsx` is a `ListDetail` with the custom header and `Modal`s the
  survey saw; `AgentEventCard.tsx` uses raw `<details>`; `AgentComposer.tsx` has the custom shell.
- `plugins/agents/src/client/toolRendererRegistry.tsx` still resolves renderers; phase 3's slot host
  lives in or beside it.
- The memory index notes on the transcript (no virtualizer, `on()` dedupe, `innerHTML` effect) still
  describe the current code; read `AgentTranscript.tsx` for the current guards.
- `docs/managed-agents.md` § "Client surfaces" describes fold seeding and the Tool call display
  setting.

## What shipped, and where it differs

Ten deviations from the plan above. Each was a decision made while building, and each is recorded here
rather than in the owning doc, because the owning doc says what is true and this says what changed.

**1. The detail region is not `header-body-footer` inside `list-detail`.** Nesting a layout inside a
region means two region-focus registrations for one pane, which is what phase 7 refused for the same
reason. It did not need one: `Timeline follow` owns the scroll and takes the height that is left, so
the header above it and the composer below it are pinned by being its siblings. The header the plan put
in a header region is a `Toolbar` at the top of the detail region, and the sidebar's count is the
`list-header` region, which is the one place a region actually earned its keep.

**2. `Timeline` learned to follow, and the transcript lost 80 lines.** The plan's guardrails were all
about the transcript's scroll, and every one of them was written in the plugin: the pin-to-bottom, the
"has the reader scrolled away" question, the per-view scroll memory, the two `ResizeObserver`s, the
echo-suppression on our own writes. `Timeline follow viewKey=…` is that machinery in the kit, where
github's conversation can have it too, and `nextFollowing` moved from the plugin to
`client-core/src/ui/followScroll.ts` with its test. The bounded map of places is the one thing that
changed: `ui/` may not import the scope-eviction store, so it holds fifty and drops the oldest instead
of clearing on a node switch.

**3. The composer is not the kit's `Composer` node.** `Composer` is the comment box: a field, a submit
and an error line. The agents footer adds config selects, a chip row, an attachment slot, two pickers,
a context preview, a stop key and a slot for other plugins, and every one of those would have been a
prop on a node with one caller. It is a `Stack` of kit nodes instead, and the only part that needed the
kit is the field.

**4. The field is `MentionTextarea`, generalised.** The plan said the mention popup "becomes the
`Composer`'s built-in mention behaviour, host-owned, so it stays live". That is what happened, at the
node one level down. The kit's `MentionTextarea` used to complete `@login` and nothing else; it takes
`sources` now, one per sigil, and `segments`, which is how a caller says which runs of the draft are
already a mention and in what tone. `activeMention`, `completeMention` and `scrollDeltaFor` moved to
`client-core/src/ui/mentions.ts`; the file-specific half stayed in the plugin, because the walk and
what a turn sends as a file part are the plugin's business. The three `--mention-*` theme tokens are
deleted: the composer names `accent`, `warn` and `ok` now, which is the closed kit's rule arriving
where a stylesheet used to be.

**5. Expanding grows the box rather than covering the transcript.** ⌘⇧↩ sets the field to eighteen
rows. The old version was `position: absolute; inset: 0` over the detail column, which is a rectangle
the kit has no name for, and the reason it had to cover rather than collapse was that the transcript
would lose its scroll position. A followed timeline does not: it is already holding a place.

**6. `Icon` gained `tone` and `spin`, and `Card` gained `focus`.** `RuntimeStateIcon` was a span with a
stylesheet that coloured it per state and turned it per state; both are props now, and the plugin's
`runtime-state-icon.css` is gone. `Card focus` is how the attention inbox lands a reader on the request
it named: the pane holds a key and the kit does the scrolling and the focusing, which is the same
argument that made collection state the host's.

**7. `Rows` reconciles by key.** The sidebar is three `Rows` collections, so it gets the arrows, Home,
End, type-ahead and a selection that survives a refetch for free. It also gets a hazard: the managed
store replaces a session's object on every socket frame, and `<For>` keys by reference, so every row
would have been disposed and recreated several times a second during a fan-out. `Rows` hands back the
same item object for an unchanged key. Fixed once in the kit rather than once per caller, because the
next live list has the same problem.

**8. Subagents are rows of the sessions collection, not a nested list.** One list to walk with the
arrows, keyed `<session id>` or `<session id>/<subagent id>`, drawn at depth one. Stepping into a
child run is a selection, not an expansion, so `TreeRow` would have been the wrong affordance.

**9. Agent Center is one scrolling column, not a `header-body` layout.** It is a rail source rather
than a pane, and a layout is a pane's arrangement. It takes the kit's one-column split as its box, the
way github browse and docker browse take the two-column one. Its four-column grid of sessions is gone
with the stylesheet: rows are stacked `Row`s with the state and the age as meta.

**10. The composer's slots are `agents:attachment` and `agents:composer-actions`.** Both are declared
in `index.ts` beside `agents:tool-card`, which had been drawn since phase 3 without a declaration of
its own. All three are in `@acorn/protocol/extensionPoints.ts` so the host's own consumers can say them
without a literal, and `extensionPoints.test.ts` holds the names, because an unmatched contribution is
silent by design.

**11. The pending-request strip lost its height cap, and `agents:tool-card` gained a declaration.**
Two smaller things. The strip of requests waiting on the reader used to be its own scroller capped at
42% of the pane; it is a `Section` above the timeline now, and a very tall request would squeeze the
transcript rather than scroll inside itself. A request is a title, a line of detail and a few buttons,
so the cap was paying for a case nobody has. Separately, `agents:tool-card` had been drawn since phase
3 but never registered, which means a loaded plugin's contribution to it could not have resolved; it is
declared in `index.ts` now with the other two.

## Owed after this phase

- The plan asked for a 500-event render budget and a "text selection survives streaming" test. Both
  are behaviours of `Timeline`, and `Timeline.test.tsx` covers the parts jsdom can answer: appending a
  turn does not replace the ones already drawn, following pins to the bottom, a reader who scrolls away
  is left alone, and a place is held per view. A wall-clock budget needs a real layout engine, so it is
  not written; the guardrail that made the old version slow, the measuring virtualizer, is gone rather
  than tuned.
- Rendering the pane itself through its regions needs a jsdom project in the plugin package, which is
  phase 9's question, not this one's. The pane's own suite holds the layout and region names.
- The smoke checklist in `docs/testing.md` covers start, send, attach, approve, rename, archive and
  fork by hand. Nothing here ran it.
- `AgentComposer.test.ts` still tests the composer's disabled-message helper and nothing about the
  slots. The `attachment` slot drawing a contributor's chip for a `.png` wants the same jsdom project.
