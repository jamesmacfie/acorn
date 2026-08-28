# Phase 8: agents

Status: not started.

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
